use serde::{Deserialize, Serialize}; // derive JSON serialization/deserialization
use serde_json::json;                // macro to build JSON values easily
use std::collections::HashMap;       use std::env::consts::DLL_PREFIX;
use std::sync::Arc;                  // atomically reference counted pointer for sharing across tasks
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader}; // async I/O helpers
use tokio::net::{TcpListener, TcpStream};                  // async TCP
use tokio::sync::{broadcast, Mutex}; // async Mutex and broadcast channel

#[derive(Serialize,Deserialize,Debug)] // this allows chartargs to be sendable over a tcp in something like a json format
struct ChatArgs{
    username: String,
    arg: String,
    msg: Option<String>,
    room: Option<String>,
}

struct Room{
    messages: Mutex<Vec<String>>, // async mutex,, holds room msg history
    sender: broadcast::Sender<String>, // broadcasts to room members
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>>{
    let listener = TcpListener::bind("0.0.0.0:8000").await?;
    println!("Rust server listening on 127:8000");

    let rooms: Arc<Mutex<HashMap<String,Room>>> = Arc::new(Mutex::new(HashMap::new()));

    loop{
        //get new client ,, async
        let(socket,addr) = listener.accept().await?;
        println!("New connection!! : {}",addr);

        //clone arc pointer so each task has a handle to the same rooms map
        let roomsClone = rooms.clone();

        // new thread per client
        tokio::spawn(async move {
            if let Err(e) = handle_client(socket,roomsClone).await{
                println!("client thread ended!!!! {}",e);
            }
        });


    }


}

async fn handle_client( socket:  TcpStream, rooms: Arc<Mutex<HashMap<String,Room>>>,) -> Result<(), Box<dyn std::error::Error>>{
    let (read,write) = socket.into_split();

    // wrap reader and writer

    let writer = Arc::new(Mutex::new(write));
    let mut reader = BufReader::new(read).lines();

    let mut currRoom: Option<String> = None; //curr room
    let mut username: Option<String> = None;

    let mut broadcast_task :Option<tokio::task::JoinHandle<()>> = None; //?? explain this

    //read from client
    while let Some(line) = reader.next_line().await?{
        let req: ChatArgs = match serde_json::from_str(&line){
            Ok(r) => r,
            Err(_) =>{
                let mut w = writer.lock().await;
                let reply = json!({"message": "Invalid JSON !!!"}).to_string();
                w.write_all(reply.as_bytes()).await?;
                continue;
            }
        };

        // set username from req
        // if let Some(u) = req.username.clone(){
        //     username = Some(u);
        // }
        username = Some(req.username.clone());


        // parse command string
        let command = req.arg.clone().to_uppercase();
    
        //switch cases;

        match command.as_str(){

            "CREATEROOM"=>{
                if let Some(room_name) = req.room.clone(){
                    // lock rooms map to write new room
                    let mut roomstemp = rooms.lock().await;

                    roomstemp.entry(room_name.clone()).or_insert_with(||{
                        let (tx,_rx) = broadcast::channel(10); // 10 clients max 
                        Room { messages: Mutex::new(Vec::new()), sender: tx }
                    });

                    //confirm to client
                    let mut w = writer.lock().await;
                    //let resp = json!({"message": format!("Room {} created!, now join it "), room_name}).to_string() +"\n";
                    let resp = json!({"message": format!("Room {} created!, now join it", room_name)}).to_string() + "\n";
                    w.write_all(resp.as_bytes()).await?;

                }
            }

            "LISTROOMS"=>{
                // lock rooms to read
                let roomstemp = rooms.lock().await;
                if roomstemp.is_empty(){
                    let mut w = writer.lock().await;
                    w.write_all(b"{\"message\":\"No rooms\"}\n").await?;

                }else{
                    let list: Vec<String> = roomstemp.keys().cloned().collect();
                    let mut w = writer.lock().await;
                    let resp = json!({ "rooms": list }).to_string() + "\n";
                    w.write_all(resp.as_bytes()).await?;
                    
                }

            }

            "JOINROOM" =>{
                if let Some(room_name) = req.room.clone(){
                    let roomstemp = rooms.lock().await;
                    if let Some(room) = roomstemp.get(&room_name){
                        //set curr room
                        currRoom = Some(room_name.clone());

                        //send history
                        let history = room.messages.lock().await.clone(); 
                        let mut w = writer.lock().await;
                        
                        //tell cliuent they joined
                        w.write_all((json!({ "message": format!("You joined {}", room_name) }).to_string() + "\n").as_bytes()).await?;

                        w.write_all((json!({ "history": history }).to_string() + "\n").as_bytes()).await?;

                        //join broaadcast
                        let mut rx = room.sender.subscribe();

                        //remove this guy from prev room broadcast if present
                        if let Some(handle) = broadcast_task.take() {
                            handle.abort(); // stop the previous background task
                        }

                        let writer_clone = writer.clone();
                        broadcast_task = Some(tokio::spawn(async move {
                            loop {
                                match rx.recv().await {
                                    Ok(msg) => {
                                        //loc writer and send broadcasted msg
                                        let mut w = writer_clone.lock().await;
                                       
                                        let out = json!({ "message": msg }).to_string() + "\n";
                                        let _ = w.write_all(out.as_bytes()).await;
                                    }
                                    Err(broadcast::error::RecvError::Lagged(_)) => {
                                        // missed messages due to slow client — continue
                                        continue;
                                    }
                                    Err(broadcast::error::RecvError::Closed) => {
                                        // channel closed, exit background task
                                        break;
                                    }
                                }
                            }
                        }));
                    } else {
                        let mut w = writer.lock().await;
                        w.write_all(b"{\"message\":\"Room does not exist!\"}\n").await?;


                    }
                }

            }

            "SENDMSG"=>{
                if currRoom.is_none() || username.is_none() {
                    let mut w = writer.lock().await;
                    w.write_all(b"{\"message\":\"Join a room first and set a username!\"}\n").await?;
                    continue;
                }

                if let (Some(room_name), Some(msg)) = (currRoom.clone(), req.msg.clone()) {
                    //lock rooms to getroom
                    let rooms_map = rooms.lock().await;
                    if let Some(room) = rooms_map.get(&room_name) {
                        let full = format!("{}: {}", username.clone().unwrap_or_default(), msg);
                        {
                            // append to history
                            let mut hist = room.messages.lock().await;
                            hist.push(full.clone());
                        }
                        
                        let _ = room.sender.send(full);
                    } else {
                        let mut w = writer.lock().await;
                        w.write_all(b"{\"message\":\"Room does not exist!\"}\n").await?;
                    }
                }

            }


            
            _ =>{
                let mut w = writer.lock().await;
                w.write_all(b"{\"message\":\"Unknown command\"}\n").await?;
            }
        }
    };

    Ok(())




}



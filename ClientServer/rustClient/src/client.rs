use serde::{de::value::Error, Deserialize, Serialize};
use std::io::{self, Write};
use std::sync::Arc;
use std::time::Duration;


use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex; // async mutex for writer sharing



#[derive(Serialize,Deserialize,Debug)] // this allows chartargs to be sendable over a tcp in something like a json format
struct ChatArgs{
    username: String,
    arg: String,
    msg: Option<String>,
    room: Option<String>,
}




// tokio async runtime: this is what tokio starts at
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>>{ // main will return a Result of either (ok) or an error
    //get username
    print!("enter username: ");
    io::stdout().flush()?; // whys there a ?
    let mut username = String::new(); // make a new mutable string for the username
    io::stdin().read_line(&mut username)?;
    let username = username.trim().to_string();

    // connect to the server::
    let stream = TcpStream::connect("server:8000").await?; // change to server for docker!! 
                    // await needed because ::connect is async, it doesnt block the thread so other stuff can run while waiting for it to connect

    // split the read and write tcp streams
    let (read,write) = stream.into_split();

    // wrap writer in a mutex lock so only one client/async task can write to it at a time and send messages to the server
    // arc allows multiple tasks to share ownership of the writer 
    let writer = Arc::new(Mutex::new(write)); // explain !!! more


    // listener to listen to always server
    let mut listener = BufReader::new(read).lines(); //explain
    tokio::spawn(async move{
        while let Ok(Some(line)) = listener.next_line().await{
            println!("{}",line);
        }
        println!("Server disconnected!!!");
    });

    // tokio async stdin sends users input to server without blocking runtime
    let mut input_lines = BufReader::new(tokio::io::stdin()).lines();

    println!("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT");

    while let Ok(Some(input)) = input_lines.next_line().await{
        let input = input.trim();
        if input.is_empty(){
            continue;
        }

        // split into commadn and rest 
        let mut parts = input.splitn(2," ");
        let mut command = parts.next().unwrap().to_uppercase();
        // we split input based on the first space
        // what does .next .unwrap do??
        let rest = parts.next().map(|s| s.to_string());


        if command == "QUIT"{
            println!("Qutting!!!");
            break;
        }

        let chat = ChatArgs{
            username : username.clone(),
            arg: command.clone(),
            room: if command == "CREATEROOM" || command == "JOINROOM"{
                rest.clone()
            }else{
                None
            },
            msg: if command =="SENDMSG" {rest.clone()} else {None},
        };

        let jsontext = serde_json::to_string(&chat)? +"\n";

        //lock writer and write
        let mut w = writer.lock().await;
        w.write_all(jsontext.as_bytes()).await?;
        w.flush().await?;

        



    }
    Ok(())

}
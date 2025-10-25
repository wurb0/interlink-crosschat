import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.PrintWriter;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.io.*;
import java.net.*;
import java.util.*;



//note; used AI for the json parsing stuff and the hashmap 

class chatArgs implements Serializable{
    public String arg;
    public String room;
    public String username;
    public String msg;
}


class ClientList{
    private ArrayList<Socket> clientList = new ArrayList<Socket>();

    public synchronized void addClient(Socket NewClient){
        clientList.add(NewClient);
        try{
            notify(); // wake up a thread
        }catch (Exception e){}
    }

    public synchronized Socket getClient(){
        if (clientList.isEmpty()){
            try{
                System.out.println("sleeping");
                wait();
            }catch (Exception e){}
            return getClient(); // loop again
        }else{
            return clientList.remove(0);
        }

    }
}

class Room{
    public ArrayList<String> messages = new ArrayList<>();
    public Map<Socket,PrintWriter> clients = new HashMap<>();
}


class Worker extends Thread{
    private ClientList list;
    private int id;

    // all chat rooms:
    private static Map<String,Room> rooms = new HashMap<>();

    // im making the client rememeber what room its in
    private String currRoom = null;
    private String username = null;

    //ObjectOutputStream oos;
    //ObjectInputStream ois;
    Socket client;
    private BufferedReader reader;
    private PrintWriter writer;


    public Worker(ClientList List, int ID){
        list = List;
        id = ID;
        start();
    }

    

    public void run(){
        System.out.println("worker "+ id+" started !!!");
        try{
            while(true){
                client = list.getClient();
                reader = new BufferedReader(new InputStreamReader(client.getInputStream()));
                writer = new PrintWriter(client.getOutputStream(),true); //autof lush

                handleClient();
            }
        }catch(Exception e){}
    }


    private void handleClient(){
        try{
            //chatArgs req;
            String line;
            while((line = reader.readLine()) != null){
                System.out.println("GOT: "+line);

                Map<String,String> req = parseJson(line);

                username = req.get("username");
                String command = req.get("arg").toUpperCase();
                String roomName = req.get("room");
                String msg = req.get("msg");

                switch(command){
                    case "CREATEROOM":
                        rooms.putIfAbsent(roomName, new Room());
                        sendToClient("{\"message\":\"Room " + roomName + " created!\"}");
                        break;
                        
                    case "LISTROOMS":
                        if (rooms.isEmpty()) {
                            sendToClient("{\"message\":\"No rooms\"}");
                        } else {
                            StringBuilder roomJson = new StringBuilder("[");
                            int count = 0;
                            for (String r : rooms.keySet()) {
                                roomJson.append("\"").append(r).append("\"");
                                if (++count < rooms.size()) roomJson.append(",");
                            }
                            roomJson.append("]");
                            sendToClient("{\"rooms\":" + roomJson.toString() + "}");
                        }
                        break;
                        
                    
                    case "JOINROOM":
                        if (rooms.containsKey(roomName)){
                            if(currRoom!=null && rooms.containsKey(currRoom)){
                                rooms.get(currRoom).clients.remove(client); // remove client from curr room if its already in one
                            }
                            currRoom = roomName;
                            Room room = rooms.get(currRoom);
                            //room.clients.add(client);
                            room.clients.put(client,writer);
                            sendToClient("{\"message\":\"You joined " + currRoom + "\"}");

                            // send the msg history obj
                            //oos.writeObject(new ArrayList<>(room.messages));
                            //sendToClient("{\"history\":\"" + room.messages + "\"}");

                            StringBuilder historyJson = new StringBuilder("[");
                            for (int i = 0; i < room.messages.size(); i++) {
                                historyJson.append("\"").append(room.messages.get(i)).append("\"");
                                if (i < room.messages.size() - 1) historyJson.append(",");
                            }
                            historyJson.append("]");
                            sendToClient("{\"history\":" + historyJson.toString() + "}");
                            
                        }else{
                            sendToClient("{\"message\":\"Room does not exist!\"}");
                        }
                        
                        break;
                    
                    case "SENDMSG":
                        if (currRoom == null){
                            sendToClient("{\"message\":\"Join a room first!\"}");

                            break;
                        }else{
                            String x = username + ": " + msg;
                            Room room = rooms.get(currRoom);

                            room.messages.add(x);

                            broadcast(room,x);
                            break;

                        }
                        
                }
            }
        }catch(Exception e){
            
            if (currRoom != null && rooms.containsKey(currRoom)) {
                rooms.get(currRoom).clients.remove(client);
            }
        }
}


    private void sendToClient(String json) {
        writer.println(json);
        System.out.println("Sent: " + json);
    }

    private Map<String, String> parseJson(String json) {
        Map<String, String> map = new HashMap<>();
        json = json.trim();
        if (json.startsWith("{") && json.endsWith("}"))
            json = json.substring(1, json.length()-1);
        String[] pairs = json.split(",");
        for(String pair : pairs) {
            String[] kv = pair.split(":", 2);
            if(kv.length == 2)
                map.put(kv[0].trim().replace("\"",""), kv[1].trim().replace("\"",""));
        }
        return map;
    }


    private void broadcast(Room room , String message){
        for (Map.Entry<Socket, PrintWriter> entry : new HashMap<>(room.clients).entrySet()) {

            try {
                entry.getValue().println("{\"message\":\"" + message + "\"}");
                entry.getValue().flush();
            } catch (Exception e) {
                // if the client is dead, remove it
                try {
                    room.clients.remove(entry.getKey());
                    entry.getKey().close();
                } catch (Exception e1) {}
            }
        }

    }
 
}

public class server{
    public static void main(String[] args) {
        try {
            //ServerSocket serverSocket = new ServerSocket(8000);
            ServerSocket serverSocket = new ServerSocket(8000, 0, InetAddress.getByName("0.0.0.0"));
            System.out.println("Server started on port 8000 !!!!!!");

            ClientList clientList = new ClientList();

            // Start worker threads
            for (int i = 0; i < 10; i++) {
                new Worker(clientList, i);
            }

            while (true) {
                Socket client = serverSocket.accept();
                System.out.println("New client connected: " + client);
                clientList.addClient(client);
            }

        } catch (Exception e) {
            System.out.println("Server error: " + e.getMessage());
        }
    }

}
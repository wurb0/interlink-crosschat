import java.rmi.RemoteException;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.util.ArrayList;
import java.util.Map;
import java.util.List;
import java.util.HashMap;

public class server implements serverInterface{

    private static class Room{
        List<String> messages = new ArrayList<>();
        Map<String, clientInterface> clients = new HashMap<>();

    }




    private Map<String, Room> rooms = new HashMap<>();
    private Map<String, String> userRoom = new HashMap<>(); //maps usernames to their curr room

    // Interface implementation !!!!





    public synchronized void createRoom(String roomName) throws RemoteException{
        rooms.putIfAbsent(roomName, new Room());
        System.out.println("Room created !!");
    }

    public synchronized List<String> joinRoom(String roomName, String username, clientInterface client) throws RemoteException{
        if(! rooms.containsKey(roomName)){
            throw new RemoteException("room doesnt exist");
        }

        //leave old room
        String oldRoom = userRoom.get(username);
        if(oldRoom != null && rooms.containsKey(oldRoom)){
            rooms.get(oldRoom).clients.remove(username);
            broadcast(oldRoom,username+ "has left");
        }

        //join new room
        Room room = rooms.get(roomName);
        room.clients.put(username,client);
        userRoom.put(username, roomName);

        List<String> history = new ArrayList<>(room.messages);
        broadcast(roomName, username +" has joined");

        return history;


    }

    public synchronized List<String> listRooms() throws RemoteException{
        return new ArrayList<>(rooms.keySet());
    }
    public synchronized String sendMsg(String roomName, String username, String msg) throws RemoteException{
        Room room = rooms.get(roomName);
        if (room == null){
            System.out.println("room doesnt exist");
        }
        String message = username +": "+ msg;
        room.messages.add(message);
        broadcast(roomName,message);    //call receive message for eveyr client in the room

        
        System.out.println("Received: "+msg);
        return "a";
    }




/////
    private void broadcast(String roomName, String msg){
        Room room = rooms.get(roomName);
        for (clientInterface client: new ArrayList<>(room.clients.values())){
            try{
                client.receiveMsg(roomName, msg);
            }catch(Exception e){
                System.out.println("COudlnt broadcast msg");
            }
        }
    }



    public static void main(String[] args){

        try{
            server obj = new server();
            serverInterface stub = (serverInterface) UnicastRemoteObject.exportObject(obj, 0);

            Registry registry = LocateRegistry.createRegistry(8101);
            registry.rebind("ChatServer", stub);

            System.out.println("Server Running !!!");







        }catch(Exception e){}

        
    }
    
}

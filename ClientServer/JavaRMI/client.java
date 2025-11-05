import java.rmi.RemoteException;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.util.Scanner;
import java.util.List;

public class client implements clientInterface{
    private String username;
    private String currRoom = null;

    public client(String username){
        this.username= username;
    }

    ////// Interface stuff
    public void receiveMsg(String roomName, String msg) throws RemoteException{
        System.out.println("[" + roomName + "] " + msg);
    }
    public void receiveHistory(String roomName, List<String> messages) throws RemoteException{
        //System.out.println("[" + roomName + "] " + messages);
        for (String msg:messages){
            System.out.println(msg);
        }

    }




    public static void main(String[] args){

        try{
            Scanner sc = new Scanner(System.in);
            System.out.print("Enter username: ");
            String username = sc.nextLine();

            client clientobj = new client(username);

            clientInterface stub = (clientInterface) UnicastRemoteObject.exportObject(clientobj, 0);

            String rmiHost = System.getenv("RMI_HOST");
            if (rmiHost == null || rmiHost.isEmpty()){
                rmiHost = "localhost";
            }
            Registry registry = LocateRegistry.getRegistry(rmiHost,8101); // this is server in docker
            serverInterface server = (serverInterface) registry.lookup("ChatServer");



            // send msg by calling server method
            // System.out.print("Enter message to send: ");
            // String msg = sc.nextLine();
            // String reply = server.sendMsg(msg);
            // System.out.println("Server replied: " + reply);


            System.out.println("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT");
            while(true){
                String line = sc.nextLine();
                String[] parts = line.split(" ", 2);
                String command = parts[0].toUpperCase();
                
                switch (command) {
                    case "CREATEROOM":
                        server.createRoom(parts[1]);
                        break;

                    case "JOINROOM":
                        List<String> history = server.joinRoom(parts[1], username, stub);
                        clientobj.currRoom = parts[1];
                        clientobj.receiveHistory(parts[1], history);
                        break;

                    case "SENDMSG":
                        if(clientobj.currRoom == null){
                            System.out.println("Join a room first!");
                        }else{
                            server.sendMsg(clientobj.currRoom, username,parts[1]);
                        }
                        break;

                    case "LISTROOMS":
                        List<String> rooms = server.listRooms();
                        System.out.println("Rooms: "+ rooms);

                        break;

                    case "QUIT":
                        return;
                
                    default:
                        System.out.println("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT");
                }




            }

        }catch(Exception e){
            System.out.println("failed to connect");
        }

    }
    
}

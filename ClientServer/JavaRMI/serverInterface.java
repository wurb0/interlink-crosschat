import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;


// this is what the client can call
public interface serverInterface extends Remote {
    String sendMsg(String roomName, String username, String msg) throws RemoteException;
    void createRoom(String name) throws RemoteException;
    List<String> listRooms() throws RemoteException;
    List<String> joinRoom(String roomName, String username, clientInterface client) throws RemoteException; // passing client interface so the server can make clients receive msgs     
    
}

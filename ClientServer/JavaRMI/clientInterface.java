import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

public interface clientInterface extends Remote {
    void receiveMsg(String roomName, String msg) throws RemoteException;
    void receiveHistory(String roomName, List<String> messages) throws RemoteException;
} 

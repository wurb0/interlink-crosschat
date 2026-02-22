import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.net.ServerSocket;
import java.net.Socket;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.rmi.server.UnicastRemoteObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class rmi_bridge {
    private static class BridgeClient implements clientInterface {
        private final PrintWriter writer;

        BridgeClient(PrintWriter writer) {
            this.writer = writer;
        }

        @Override
        public synchronized void receiveMsg(String roomName, String msg) {
            sendJsonMessage(msg);
        }

        @Override
        public synchronized void receiveHistory(String roomName, List<String> messages) {
            sendJsonHistory(messages);
        }

        private void sendJsonMessage(String msg) {
            String safe = msg == null ? "" : msg.replace("\\", "\\\\").replace("\"", "\\\"");
            writer.println("{\"message\":\"" + safe + "\"}");
            writer.flush();
        }

        private void sendJsonHistory(List<String> messages) {
            if (messages == null) {
                writer.println("{\"history\":[]}");
                writer.flush();
                return;
            }

            StringBuilder sb = new StringBuilder("{\"history\":[");
            for (int i = 0; i < messages.size(); i++) {
                if (i > 0) sb.append(",");
                String safe = messages.get(i) == null ? "" : messages.get(i).replace("\\", "\\\\").replace("\"", "\\\"");
                sb.append("\"").append(safe).append("\"");
            }
            sb.append("]}");
            writer.println(sb.toString());
            writer.flush();
        }
    }

    private static class ClientHandler extends Thread {
        private final Socket socket;
        private final serverInterface server;

        ClientHandler(Socket socket, serverInterface server) {
            this.socket = socket;
            this.server = server;
        }

        @Override
        public void run() {
            BridgeClient callback = null;
            clientInterface callbackStub = null;

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
                 PrintWriter writer = new PrintWriter(socket.getOutputStream(), true)) {

                callback = new BridgeClient(writer);
                callbackStub = (clientInterface) UnicastRemoteObject.exportObject(callback, 0);

                String currentRoom = null;

                String line;
                while ((line = reader.readLine()) != null) {
                    Map<String, String> req = parseJson(line);

                    String username = req.get("username");
                    String command = req.getOrDefault("arg", "").toUpperCase();
                    String room = req.get("room");
                    String msg = req.get("msg");

                    switch (command) {
                        case "CREATEROOM":
                            if (room == null || room.isBlank()) {
                                writer.println("{\"message\":\"Room name required\"}");
                                break;
                            }
                            server.createRoom(room);
                            writer.println("{\"message\":\"Room " + esc(room) + " created!\"}");
                            break;

                        case "LISTROOMS":
                            List<String> rooms = server.listRooms();
                            writer.println(toRoomsJson(rooms));
                            break;

                        case "JOINROOM":
                            if (room == null || room.isBlank()) {
                                writer.println("{\"message\":\"Room name required\"}");
                                break;
                            }
                            if (username == null || username.isBlank()) {
                                writer.println("{\"message\":\"Username required\"}");
                                break;
                            }
                            List<String> history = server.joinRoom(room, username, callbackStub);
                            currentRoom = room;
                            writer.println("{\"message\":\"You joined " + esc(room) + "\"}");
                            writer.println(toHistoryJson(history));
                            break;

                        case "SENDMSG":
                            if (currentRoom == null || currentRoom.isBlank()) {
                                writer.println("{\"message\":\"Join a room first!\"}");
                                break;
                            }
                            if (username == null || username.isBlank()) {
                                writer.println("{\"message\":\"Username required\"}");
                                break;
                            }
                            if (msg == null || msg.isBlank()) {
                                writer.println("{\"message\":\"Message required\"}");
                                break;
                            }
                            server.sendMsg(currentRoom, username, msg);
                            break;

                        default:
                            writer.println("{\"message\":\"Unknown command\"}");
                            break;
                    }
                }

            } catch (Exception e) {
                //dont kill whole bridge if one client fails
            } finally {
                try {
                    socket.close();
                } catch (Exception ignored) {}

                if (callback != null) {
                    try {
                        UnicastRemoteObject.unexportObject(callback, true);
                    } catch (Exception ignored) {}
                }
            }
        }

        private static String toRoomsJson(List<String> rooms) {
            if (rooms == null) return "{\"rooms\":[]}";
            StringBuilder sb = new StringBuilder("{\"rooms\":[");
            for (int i = 0; i < rooms.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append("\"").append(esc(rooms.get(i))).append("\"");
            }
            sb.append("]}");
            return sb.toString();
        }

        private static String toHistoryJson(List<String> history) {
            if (history == null) return "{\"history\":[]}";
            StringBuilder sb = new StringBuilder("{\"history\":[");
            for (int i = 0; i < history.size(); i++) {
                if (i > 0) sb.append(",");
                sb.append("\"").append(esc(history.get(i))).append("\"");
            }
            sb.append("]}");
            return sb.toString();
        }

        private static String esc(String s) {
            if (s == null) return "";
            return s.replace("\\", "\\\\").replace("\"", "\\\"");
        }

        private static Map<String, String> parseJson(String json) {
            Map<String, String> map = new HashMap<>();
            try {
                String body = json.trim();
                if (body.startsWith("{") && body.endsWith("}")) {
                    body = body.substring(1, body.length() - 1);
                }

                String[] pairs = body.split(",");
                for (String pair : pairs) {
                    String[] kv = pair.split(":", 2);
                    if (kv.length != 2) continue;
                    String key = kv[0].trim().replace("\"", "");
                    String value = kv[1].trim();
                    if (value.startsWith("\"") && value.endsWith("\"")) {
                        value = value.substring(1, value.length() - 1);
                    }
                    value = value.replace("\\\"", "\"").replace("\\\\", "\\");
                    map.put(key, value);
                }
            } catch (Exception ignored) {}
            return map;
        }
    }

    public static void main(String[] args) {
        try {
            String rmiHost = System.getenv("RMI_HOST");
            if (rmiHost == null || rmiHost.isBlank()) rmiHost = "javarmi-server";

            int rmiPort = Integer.parseInt(System.getenv().getOrDefault("RMI_PORT", "8101"));
            int bridgePort = Integer.parseInt(System.getenv().getOrDefault("BRIDGE_PORT", "8201"));

            Registry registry = LocateRegistry.getRegistry(rmiHost, rmiPort);
            serverInterface server = (serverInterface) registry.lookup("ChatServer");

            ServerSocket serverSocket = new ServerSocket(bridgePort);
            System.out.println("RMI bridge listening on " + bridgePort + ", target=" + rmiHost + ":" + rmiPort);

            while (true) {
                Socket client = serverSocket.accept();
                new ClientHandler(client, server).start();
            }
        } catch (Exception e) {
            System.out.println("Bridge failed: " + e.getMessage());
        }
    }
}

import grpc
import threading
from chat_pb2 import JoinRoomReq, SendMsgReq, CreateRoomReq, ListRoomsReq
import chat_pb2_grpc

def listen_stream(stub, username, roomName):
    """Listen for streamed messages from the server."""
    request = JoinRoomReq(username=username, roomName=roomName)
    try:
        for msg in stub.joinRoom(request):

            ##
            # msg is StreamMsg which contains a Message
            print(f"[{msg.msg.roomName}] {msg.msg.username}: {msg.msg.msg}")
    except grpc.RpcError as e:
        print(f"[Stream error] {e.details()}")

def main():
    username = input("Enter username: ").strip()
    channel = grpc.insecure_channel('server:50051') ## change to server for docke!!!
    stub = chat_pb2_grpc.ChatServiceStub(channel)

    currRoom = None
    listener_thread = None

    print("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT")

    while True:
        line = input().strip()
        if not line:
            continue

        parts = line.split(" ", 1)
        command = parts[0].upper()

        if command == "CREATEROOM":
            if len(parts) < 2:
                print("Usage: CREATEROOM <name>")
                continue
            res = stub.createRoom(CreateRoomReq(roomName=parts[1]))
            print(res.success or res.error)

        elif command == "LISTROOMS":
            res = stub.listRooms(ListRoomsReq())
            print("Rooms:", res.rooms)

        elif command == "JOINROOM":
            if len(parts) < 2:
                print("Usage: JOINROOM <name>")
                continue
            roomName = parts[1]
            currRoom = roomName

            # Join room to get history and start listening
            def join_and_listen():
                for msg in stub.joinRoom(JoinRoomReq(username=username, roomName=currRoom)):
                    print(f"[{msg.msg.roomName}] {msg.msg.username}: {msg.msg.msg}")

            listener_thread = threading.Thread(target=join_and_listen, daemon=True)
            listener_thread.start()
            print(f"Joined {currRoom}. Listening to messages...")

        elif command == "SENDMSG":
            if len(parts) < 2:
                print("Usage: SENDMSG <message>")
                continue
            if not currRoom:
                print("Join a room first! !")
                continue
            msg_text = parts[1]
            stub.sendMsg(SendMsgReq(roomName=currRoom, username=username, msg=msg_text))

        elif command == "QUIT":
            print("Exiting")
            break

        else:
            print("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT")

if __name__ == "__main__":
    main()

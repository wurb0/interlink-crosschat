import grpc
import queue
import concurrent.futures as futures
#from generated import chat_pb2, chat_pb2_grpc
import chat_pb2
import chat_pb2_grpc
import threading

rooms = {}  # map roomName to a Room obj
userRoom ={} ##map username to a roomname

active_streams={}
class Room:
    def __init__(self):
        self.messages= []
        self.clients = []

class ChatServicer(chat_pb2_grpc.ChatServiceServicer):

    def createRoom(self, req,context):
        if req.roomName in rooms:
            return chat_pb2.CreateRoomRes(success="", error="Room already exists !")
            
        rooms[req.roomName] = Room()
        print(f"Room Created!")
        return chat_pb2.CreateRoomRes(success="Room Created !",error="")
    
    def listRooms(self,req,context):
        return chat_pb2.ListRoomsRes(rooms=list(rooms.keys()))
    
    def joinRoom(self,req,context):
        username = req.username
        roomName = req.roomName

        if roomName not in rooms:
            print("Room does not exist!!")
            return
        
        # // leave old room
        oldRoom = userRoom.get(username)
        if oldRoom:
            oldRoom = rooms.get(oldRoom)
            if oldRoom:
                old_queue = active_streams.get(username)
                if old_queue:
                    old_queue.put(None)
                oldRoom.clients = [q for q in oldRoom.clients if q!= old_queue]
                self.broadcast(oldRoom, f"{username} has left.")

        #join new room
        room = rooms[roomName]
        userRoom[username] = roomName

        client_queue = queue.Queue()
        room.clients.append(client_queue)
        active_streams[username] = client_queue

        #send histry
        for msg in room.messages:
            yield chat_pb2.StreamMsg(msg = msg)

        self.broadcast(room, f"{username} joined")

        while True:
            try:
                msg = client_queue.get(timeout=50)
                yield chat_pb2.StreamMsg(msg=msg)
            except queue.Empty:
                continue

    def sendMsg(self,req,context):
        roomName = req.roomName
        username = req.username
        msg = req.msg

        if roomName not in rooms:
            return chat_pb2.CreateRoomRes(success='',error='Room doesnt exist!!')
        
        room = rooms[roomName]
        message = chat_pb2.Message(
            roomName = roomName,
            username = username,
            msg = msg
        )
        room.messages.append(message)

        self.broadcast(room, message)
        print(f"[{roomName}] {username}: { msg}")
        return chat_pb2.CreateRoomRes(success='',error='')
    
    def broadcast(self,room,msg):
        for client_queue in room.clients:
            if isinstance(msg,str):
                client_queue.put(chat_pb2.Message(
                    roomName = "",
                    username = "Server",
                    msg = msg
                ))
            else:
                client_queue.put(msg)

def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    chat_pb2_grpc.add_ChatServiceServicer_to_server(ChatServicer(),server)
    server.add_insecure_port('[::]:50051')
    server.start()
    print("Server running on port 50051")
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        print("Edning!!")
        server.stop(0)
        

if __name__ == "__main__":
    serve()


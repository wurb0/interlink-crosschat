using System;
using System.Net.Sockets;
using System.IO;
using System.Threading.Tasks;
using System.Text.Json;


public class ChatArgs
{
    public string username { get; set; }
    public string arg { get; set; }
    public string msg { get; set; }
    public string room{get;set;}

}
public class Client
{
    
    private static TcpClient tcpClient;
    private static StreamReader reader;
    private static StreamWriter writer;
    private static string username;

    public static async Task Main()
    {
        Console.Write("Enter username: ");
        username = Console.ReadLine();
        try
        {
        
            tcpClient = new TcpClient("server", 8000); //connect to java server // CHANGE THIS TO SERVER FORDOCKER

            NetworkStream stream = tcpClient.GetStream(); // get network strem??

            reader = new StreamReader(stream);
            writer = new StreamWriter(stream);

            Console.WriteLine("Connected to server!!");

            Console.WriteLine("Commands: CREATEROOM <name>, LISTROOMS, JOINROOM <name>, SENDMSG <message>, QUIT");

            // need to read and listen to the server
            // listen:
            //_ = Listener();

            Task.Run(() => Listener());
            while (true)
            {
                string input = Console.ReadLine();

                if (string.IsNullOrEmpty(input))
                {
                    continue;
                }

                //parse the string;
                string[] parts = input.Split(' ', 2);
                string command = parts[0].ToUpper();
                string rest = parts.Length > 1 ? parts[1] : ""; // if theres something after the command make it 'rest' else empty so youre only sending a command to the serer

                //send to server;
                ChatArgs send = new ChatArgs()
                {
                    arg = command,
                    username = username,


                };

                switch (command)
                {
                    case "JOINROOM":


                    case "CREATEROOM":
                        send.room = rest;
                        break;

                    case "SENDMSG":
                        send.msg = rest;
                        break;


                    case "LISTROOMS":
                        //Console.WriteLine("in listrooms case");
                        break;

                    case "QUIT":
                        tcpClient.Close();
                        break;


                    default:
                        Console.WriteLine("choose a command...");
                        continue;
                }

                string json = JsonSerializer.Serialize(send);
                //System.Text.Json.JsonSerializer.Serialize(send);
                writer.WriteLine(json); //actually send
                writer.Flush();



            }

        }
        catch (Exception e)
        {
            Console.WriteLine("failed to connect to sercer;");
        }


    }

    private static void Listener()
    {
       
        try
        {
            while (true)
            {
                string incoming = reader.ReadLine();
                if (incoming == null)
                {
                    break;
                }
                try
                {
                    var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(incoming);

                    if (dict.ContainsKey("message"))
                    {
                        Console.WriteLine(dict["message"].GetString());
                    }
                    else if (dict.ContainsKey("history"))
                    {
                        var histArray = dict["history"];
                        if (histArray.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var msg in histArray.EnumerateArray())
                            {
                                Console.WriteLine(msg.GetString());
                            }
                        }
                    }
                    else if (dict.ContainsKey("rooms"))
                    {
                        var roomsarray = dict["rooms"];
                        if (roomsarray.ValueKind == JsonValueKind.Array)
                        {
                            Console.WriteLine("Rooms: ");
                            foreach (var room in roomsarray.EnumerateArray())
                            {
                                Console.WriteLine(" " + room.GetString());
                            }
                        }
                    }

                }
                catch (Exception e1)
                {
                    Console.WriteLine(incoming);//failsafe
                }
            }
            
        }
        catch (Exception e) { }

    }
    

}

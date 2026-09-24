import asyncio
import websockets
import json

async def main():
    async with websockets.connect("ws://13.203.71.14:8000/ws") as ws:
        print("Connected to ws://13.203.71.14:8000/ws")
        # Try sending a message
        await ws.send(json.dumps({"type": "subscribe", "camera_id": "cam-01"}))
        print("Sent subscribe")
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            print("Received from server:", msg)
        except asyncio.TimeoutError:
            print("Timeout waiting for response")

if __name__ == "__main__":
    asyncio.run(main())

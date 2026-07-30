import asyncio
import json
import websockets

async def main():
    async with websockets.connect("ws://127.0.0.1:8000/ws") as ws:
        await ws.send(json.dumps({"type": "subscribe", "camera_id": "e2e-test"}))
        print("Subscribed to e2e-test! Listening for telemetry...")
        for i in range(10):
            msg = await ws.recv()
            data = json.loads(msg)
            cam_data = data.get("data", {}).get("e2e-test", {})
            dets = cam_data.get("detections", [])
            print(f"Tick {i+1}: {len(dets)} detections ->")
            for d in dets:
                print("  -", d["class"], "conf:", d["confidence"], "bbox:", d["bbox"], "speed:", d.get("speed"))
            await asyncio.sleep(0.3)

if __name__ == "__main__":
    asyncio.run(main())

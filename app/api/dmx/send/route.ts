import { getState, setDmxChannels, getDmxBuffer } from "@/app/lib/dmx-state";
import type { DMXSendRequest, DMXSendResponse } from "@/app/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DMXSendRequest;
    const { channels } = body;

    if (!channels || typeof channels !== "object") {
      return Response.json(
        { error: "Missing required field: channels" },
        { status: 400 }
      );
    }

    setDmxChannels(channels);

    const state = getState();
    const channelsSent = Object.keys(channels).length;

    // If hardware is connected, write to it
    if (state.connected && !state.simulation && state.serialPort) {
      try {
        if (state.driver === "soundswitch") {
          // SoundSwitch driver handles its own frame sending at 40Hz
          // We just update the channel values
          const driver = state.serialPort as { setChannels: (ch: Record<number, number>) => void };
          driver.setChannels(channels);
        } else if (state.driver === "enttec-open") {
          // enttec-open-dmx-usb uses setChannels with 1-indexed channel map
          const device = state.serialPort as { setChannels: (ch: Record<number, number>) => void };
          device.setChannels(channels);
        } else if (state.driver === "raw-serial" || state.driver === "enttec-pro") {
          // For raw serial, write the full DMX buffer
          const port = state.serialPort as {
            write: (data: Buffer) => void;
            set: (options: { brk: boolean }) => void;
            drain: (cb: (err: Error | null) => void) => void;
          };

          if (state.driver === "raw-serial") {
            port.set({ brk: true });
            await new Promise((resolve) => setTimeout(resolve, 1));
            port.set({ brk: false });
            await new Promise((resolve) => setTimeout(resolve, 0.1));
          }

          const buf = getDmxBuffer();
          const frame = Buffer.from(buf);

          if (state.driver === "enttec-pro") {
            // Wrap in Enttec Pro packet
            const len = frame.length;
            const header = Buffer.from([0x7e, 6, len & 0xff, (len >> 8) & 0xff]);
            const footer = Buffer.from([0xe7]);
            port.write(Buffer.concat([header, frame, footer]));
          } else {
            port.write(frame);
          }
        }
      } catch (err) {
        return Response.json(
          {
            success: false,
            simulation: false,
            channelsSent,
            error: err instanceof Error ? err.message : String(err),
          },
          { status: 500 }
        );
      }
    }

    const response: DMXSendResponse = {
      success: true,
      simulation: state.simulation,
      channelsSent,
    };
    return Response.json(response);
  } catch (err) {
    return Response.json(
      { error: `DMX send failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

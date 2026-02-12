import { getState, getDmxBuffer } from "@/app/lib/dmx-state";

export async function POST() {
  try {
    // Zero all channels
    const buf = getDmxBuffer();
    buf.fill(0);

    const state = getState();

    // If hardware is connected, write blackout
    if (state.connected && !state.simulation && state.serialPort) {
      try {
        if (state.driver === "soundswitch") {
          const driver = state.serialPort as { blackout: () => void };
          driver.blackout();
        } else if (state.driver === "enttec-open") {
          const device = state.serialPort as {
            setChannels: (ch: Record<number, number>) => void;
          };
          const allZero: Record<number, number> = {};
          for (let i = 1; i <= 512; i++) allZero[i] = 0;
          device.setChannels(allZero);
        } else if (state.driver === "raw-serial" || state.driver === "enttec-pro") {
          const port = state.serialPort as {
            write: (data: Buffer) => void;
            set: (options: { brk: boolean }) => void;
          };

          if (state.driver === "raw-serial") {
            port.set({ brk: true });
            await new Promise((resolve) => setTimeout(resolve, 1));
            port.set({ brk: false });
            await new Promise((resolve) => setTimeout(resolve, 0.1));
          }

          const frame = Buffer.alloc(513, 0);

          if (state.driver === "enttec-pro") {
            const len = frame.length;
            const header = Buffer.from([0x7e, 6, len & 0xff, (len >> 8) & 0xff]);
            const footer = Buffer.from([0xe7]);
            port.write(Buffer.concat([header, frame, footer]));
          } else {
            port.write(frame);
          }
        }
      } catch {
        // Best effort blackout - don't fail the request
      }
    }

    return Response.json({ success: true, simulation: state.simulation });
  } catch (err) {
    return Response.json(
      { error: `Blackout failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

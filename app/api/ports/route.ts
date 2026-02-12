import { SerialPort } from "serialport";
import type { PortsResponse } from "@/app/lib/types";

export async function POST() {
  try {
    const ports = await SerialPort.list();

    const classified = ports.map((p) => {
      const mfr = (p.manufacturer || "").toLowerCase();
      const vid = (p.vendorId || "").toLowerCase();
      const prod = ((p as { product?: string }).product || p.pnpId || "").toLowerCase();

      let category: "ftdi" | "soundswitch" | "unknown" = "unknown";
      let categoryReason = "No matching identifiers";

      if (vid === "0403" || mfr.includes("ftdi") || mfr.includes("future technology")) {
        category = "ftdi";
        categoryReason =
          vid === "0403" ? "FTDI vendor ID (0x0403)" : `Manufacturer: ${p.manufacturer}`;
      } else if (
        mfr.includes("soundswitch") ||
        mfr.includes("inmusic") ||
        mfr.includes("denon") ||
        prod.includes("soundswitch")
      ) {
        category = "soundswitch";
        categoryReason = `Identified as SoundSwitch hardware: ${p.manufacturer || (p as { product?: string }).product || p.pnpId}`;
      }

      return {
        path: p.path,
        manufacturer: p.manufacturer || null,
        vendorId: p.vendorId || null,
        productId: p.productId || null,
        serialNumber: p.serialNumber || null,
        category,
        categoryReason,
      };
    });

    const response: PortsResponse = {
      ports: classified,
      summary: {
        total: classified.length,
        ftdi: classified.filter((p) => p.category === "ftdi").length,
        soundswitch: classified.filter((p) => p.category === "soundswitch").length,
        unknown: classified.filter((p) => p.category === "unknown").length,
      },
    };

    return Response.json(response);
  } catch (err) {
    return Response.json(
      { error: `Failed to list ports: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["serialport", "enttec-open-dmx-usb", "usb"],
};

export default nextConfig;

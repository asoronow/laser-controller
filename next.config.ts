import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["serialport", "enttec-open-dmx-usb", "usb"],
};

export default nextConfig;

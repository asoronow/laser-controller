// --- Port scanning ---

export interface PortInfo {
  path: string;
  manufacturer: string | null;
  vendorId: string | null;
  productId: string | null;
  serialNumber: string | null;
  category: "ftdi" | "soundswitch" | "unknown";
  categoryReason: string;
}

export interface PortsResponse {
  ports: PortInfo[];
  summary: {
    total: number;
    ftdi: number;
    soundswitch: number;
    unknown: number;
  };
}

// --- USB enumeration ---

export interface UsbDeviceInfo {
  vendorId: number;
  productId: number;
  deviceClass: number;
  deviceSubClass: number;
  deviceProtocol: number;
  manufacturer: string | null;
  product: string | null;
  serialNumber: string | null;
  busNumber: number;
  deviceAddress: number;
  classLabel: string;
}

export interface UsbResponse {
  devices: UsbDeviceInfo[];
}

// --- Probe ---

export type ProbeMethod = "soundswitch" | "enttec-open" | "enttec-pro" | "raw-serial" | "raw-250k";

export interface ProbeRequest {
  port: string;
  method: ProbeMethod;
  testFrame?: boolean;
}

export interface ProbeResponse {
  success: boolean;
  method: string;
  port: string;
  details: string;
  error: string | null;
  timing: number;
  portInfo: {
    baudRate?: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
  } | null;
}

// --- DMX ---

export interface DMXSendRequest {
  channels: Record<number, number>;
}

export interface DMXSendResponse {
  success: boolean;
  simulation: boolean;
  channelsSent: number;
}

// --- Status ---

export interface StatusResponse {
  connected: boolean;
  simulation: boolean;
  driver: string | null;
  port: string | null;
  adapterName: string;
  error: string | null;
}

// --- Adapter state (server-side) ---

export interface AdapterState {
  connected: boolean;
  simulation: boolean;
  driver: string | null;
  port: string | null;
  adapterName: string;
  error: string | null;
  serialPort: unknown | null;
  dmxBuffer: number[];
}

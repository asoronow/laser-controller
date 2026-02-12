import { getState } from "@/app/lib/dmx-state";
import type { StatusResponse } from "@/app/lib/types";

export async function GET() {
  const state = getState();
  const response: StatusResponse = {
    connected: state.connected,
    simulation: state.simulation,
    driver: state.driver,
    port: state.port,
    adapterName: state.adapterName,
    error: state.error,
  };
  return Response.json(response);
}

"""
sniff-lldb.py — Capture SoundSwitch USB activity using lldb
Works WITHOUT disabling SIP (lldb can debug third-party apps).

Usage:
  1. Open SoundSwitch, wait for blue LED
  2. Run: lldb -p $(pgrep -f 'SoundSwitch.app/Contents/MacOS/SoundSwitch$') -s scripts/sniff-lldb.py

  Or attach manually:
    lldb -p <PID>
    command source scripts/sniff-lldb.py
"""
import lldb

def hex_bytes(data, length):
    """Read memory and format as hex bytes"""
    error = lldb.SBError()
    bytes_read = lldb.debugger.GetSelectedTarget().GetProcess().ReadMemory(data, min(length, 32), error)
    if error.Success() and bytes_read:
        return ' '.join(f'{b:02x}' for b in bytes_read)
    return '<unreadable>'

# ── FT_Write breakpoint ──
# FT_Write(handle, buffer, bytesToWrite, bytesWritten)
def ft_write_handler(frame, bp_loc, dict):
    buf = frame.FindRegister("x1").GetValueAsUnsigned() if frame.FindRegister("x1").IsValid() else frame.FindRegister("rsi").GetValueAsUnsigned()
    length = frame.FindRegister("x2").GetValueAsUnsigned() if frame.FindRegister("x2").IsValid() else frame.FindRegister("rdx").GetValueAsUnsigned()
    data_hex = hex_bytes(buf, length)
    print(f'[D2XX] FT_Write(len={length}) data: {data_hex}')
    return False  # Don't stop

def ft_open_handler(frame, bp_loc, dict):
    idx = frame.FindRegister("x0").GetValueAsUnsigned() if frame.FindRegister("x0").IsValid() else frame.FindRegister("rdi").GetValueAsUnsigned()
    print(f'[D2XX] FT_Open(index={idx})')
    return False

def ft_setbaud_handler(frame, bp_loc, dict):
    baud = frame.FindRegister("x1").GetValueAsUnsigned() if frame.FindRegister("x1").IsValid() else frame.FindRegister("rsi").GetValueAsUnsigned()
    print(f'[D2XX] FT_SetBaudRate({baud})')
    return False

def ft_setdata_handler(frame, bp_loc, dict):
    bits = frame.FindRegister("x1").GetValueAsUnsigned() if frame.FindRegister("x1").IsValid() else frame.FindRegister("rsi").GetValueAsUnsigned()
    stops = frame.FindRegister("x2").GetValueAsUnsigned() if frame.FindRegister("x2").IsValid() else frame.FindRegister("rdx").GetValueAsUnsigned()
    parity = frame.FindRegister("x3").GetValueAsUnsigned() if frame.FindRegister("x3").IsValid() else frame.FindRegister("rcx").GetValueAsUnsigned()
    print(f'[D2XX] FT_SetDataCharacteristics(bits={bits}, stops={stops}, parity={parity})')
    return False

def ft_generic_handler(frame, bp_loc, dict):
    name = bp_loc.GetBreakpoint().GetNumLocations()
    # Get function name from the symbol
    symbol = frame.GetSymbol()
    if symbol:
        print(f'[D2XX] {symbol.GetName()}()')
    return False

# Set up breakpoints
debugger = lldb.debugger
target = debugger.GetSelectedTarget()

# D2XX functions with custom handlers
bp = target.BreakpointCreateByName("FT_Write")
bp.SetScriptCallbackFunction("sniff-lldb.ft_write_handler")
bp.SetAutoContinue(True)
print(f"FT_Write breakpoint: {bp.GetNumLocations()} location(s)")

bp = target.BreakpointCreateByName("FT_Open")
bp.SetScriptCallbackFunction("sniff-lldb.ft_open_handler")
bp.SetAutoContinue(True)

bp = target.BreakpointCreateByName("FT_SetBaudRate")
bp.SetScriptCallbackFunction("sniff-lldb.ft_setbaud_handler")
bp.SetAutoContinue(True)

bp = target.BreakpointCreateByName("FT_SetDataCharacteristics")
bp.SetScriptCallbackFunction("sniff-lldb.ft_setdata_handler")
bp.SetAutoContinue(True)

# Simple log-and-continue for other D2XX functions
for func_name in [
    "FT_OpenEx", "FT_Close", "FT_ResetDevice",
    "FT_SetFlowControl", "FT_SetTimeouts", "FT_SetLatencyTimer",
    "FT_SetUSBParameters", "FT_Purge",
    "FT_SetDtr", "FT_ClrDtr", "FT_SetRts", "FT_ClrRts",
    "FT_SetBreakOn", "FT_SetBreakOff",
    "FT_Read", "FT_GetQueueStatus",
    "FT_SetVIDPID", "FT_CreateDeviceInfoList",
    "FT_SetBitMode",
    # libusb functions (may be in libftd2xx)
    "libusb_bulk_transfer", "libusb_control_transfer",
    "libusb_claim_interface", "libusb_set_configuration",
    "libusb_set_interface_alt_setting",
]:
    bp = target.BreakpointCreateByName(func_name)
    if bp.GetNumLocations() > 0:
        bp.SetAutoContinue(True)
        # Use command-based logging since script callbacks with module names are tricky
        bp.SetCondition("")
        print(f"  {func_name}: {bp.GetNumLocations()} location(s)")

print("\nBreakpoints set. Continuing process...")
print("Watch for [D2XX] output. Press Ctrl+C to stop.\n")

# Continue the process
debugger.GetSelectedTarget().GetProcess().Continue()

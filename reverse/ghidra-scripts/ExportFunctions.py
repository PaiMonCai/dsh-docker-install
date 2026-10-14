# Ghidra Jython: export bounded pseudocode without executing target.
# @category Reverse
import json
from ghidra.app.decompiler import DecompInterface

args = getScriptArgs()
if len(args) != 2:
    raise ValueError("expected output path and maximum function count")
destination = args[0]
limit = max(1, min(200, int(args[1])))
program = currentProgram
decompiler = DecompInterface()
decompiler.openProgram(program)
rows = []
try:
    iterator = program.getFunctionManager().getFunctions(True)
    while iterator.hasNext() and len(rows) < limit and not monitor.isCancelled():
        function = iterator.next()
        row = {"name": str(function.getName())[:200],
               "address": str(function.getEntryPoint()),
               "signature": str(function.getSignature())[:1000]}
        try:
            result = decompiler.decompileFunction(function, 12, monitor)
            if result.decompileCompleted() and result.getDecompiledFunction():
                row["pseudocode"] = str(result.getDecompiledFunction().getC())[:4000]
            else:
                row["warning"] = "decompilation incomplete"
        except Exception:
            row["warning"] = "decompilation failed"
        rows.append(row)
finally:
    decompiler.dispose()
payload = {"schema": "dsh-reverse-ghidra/v1", "program": str(program.getName()),
           "image_base": str(program.getImageBase()), "functions": rows,
           "limitations": ["Function count and pseudocode length are bounded.",
                           "Pseudocode is not the original source code."]}
with open(destination, "w") as output:
    json.dump(payload, output, indent=2)
println("DSH reverse exported %d functions" % len(rows))

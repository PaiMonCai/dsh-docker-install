# Ghidra Jython: bounded static function decompilation and cross-reference graph.
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
edges = []
refs = []
max_edges = min(4000, limit * 20)
max_refs = min(4000, limit * 20)
functions = {}
try:
    iterator = program.getFunctionManager().getFunctions(True)
    while iterator.hasNext() and len(rows) < limit and not monitor.isCancelled():
        function = iterator.next()
        address = str(function.getEntryPoint())
        functions[address] = function
        row = {"name": str(function.getName())[:200],
               "address": address,
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

# Only include call edges among exported functions. This preserves graph consistency:
# a referenced node never claims to have a decompiled body unless it is in rows.
for caller_addr in sorted(functions):
    if monitor.isCancelled() or len(edges) >= max_edges:
        break
    fn = functions[caller_addr]
    try:
        callees = fn.getCalledFunctions(monitor)
        for callee in sorted(callees, key=lambda f: str(f.getEntryPoint())):
            if len(edges) >= max_edges:
                break
            target = str(callee.getEntryPoint())
            if target in functions:
                edges.append({"source": caller_addr, "target": target, "kind": "call"})
    except Exception:
        pass

# Address-based function entry-point references (direct references only, not
# speculative dynamic calls). The external source location is retained.
manager = program.getReferenceManager()
for target in sorted(functions):
    if monitor.isCancelled() or len(refs) >= max_refs:
        break
    fn = functions[target]
    try:
        iter_refs = manager.getReferencesTo(fn.getEntryPoint())
        for reference in iter_refs:
            if len(refs) >= max_refs:
                break
            refs.append({"target": target,
                         "from": str(reference.getFromAddress()),
                         "type": str(reference.getReferenceType())[:80]})
    except Exception:
        pass

payload = {
    "schema": "dsh-reverse-ghidra/v2",
    "program": str(program.getName()),
    "image_base": str(program.getImageBase()),
    "functions": rows,
    "call_graph": {
        "nodes": [{"address": row["address"], "name": row["name"]} for row in rows],
        "edges": edges,
        "truncated": len(edges) >= max_edges
    },
    "references": {"entries": refs, "truncated": len(refs) >= max_refs},
    "limitations": [
        "Function count, call edges, references and pseudocode lengths are bounded.",
        "Only edges between exported functions are included; indirect calls may be missed.",
        "Entry-point references do not include every reference to a function body.",
        "Pseudocode is reconstructed, not original source code.",
        "No input executable is run."
    ]
}
with open(destination, "w") as output:
    json.dump(payload, output, indent=2)
println("DSH reverse exported %d functions, %d calls and %d references" %
        (len(rows), len(edges), len(refs)))

import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { spawn } from "child_process";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;
  const MIN_REQUEST_TIMEOUT_MS = 180000;
  const EXTENDED_REQUEST_TIMEOUT_MS = 300000;

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!error) {
      return next();
    }

    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Request payload is too large for the evolution server." });
    }

    if (error instanceof SyntaxError && "body" in error) {
      return res.status(400).json({ error: "Invalid JSON request body." });
    }

    console.error("Request parsing error:", error);
    return res.status(500).json({ error: "Failed to parse the incoming request." });
  });

  // API Routes for evolution
  app.post("/api/search", (req, res) => {
    const { query, sourceConfig } = req.body;
    if (!query) return res.status(400).json({ error: "Query is required" });
    runPython("search", query, sourceConfig || {}, res);
  });

  app.post("/api/evolve", (req, res) => {
    const { query, population } = req.body;
    if (!query || !population) return res.status(400).json({ error: "Query and population are required" });
    runPython("evolve", query, population, res);
  });

  app.post("/api/assemble", (req, res) => {
    const { query, population } = req.body;
    if (!query || !population) return res.status(400).json({ error: "Query and population are required" });
    runPython("assemble", query, population, res);
  });

  function runPython(mode: string, query: string, data: any, res: any) {
    const args = ["evolution_engine.py", mode, query];
    const requestTimeoutMs = mode === "search"
      ? MIN_REQUEST_TIMEOUT_MS
      : EXTENDED_REQUEST_TIMEOUT_MS;

    let dataString = "";
    let errorString = "";
    let responded = false;
    let timedOut = false;

    const sendJsonError = (status: number, payload: Record<string, unknown>) => {
      if (responded || res.headersSent) return;
      responded = true;
      res.status(status).json(payload);
    };

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    let pythonProcess: any = null;
    let timeoutHandle: NodeJS.Timeout;

    function setupProcessHandlers(proc: any) {
      if (!proc) return;

      if (data !== null && data !== undefined) {
        proc.stdin.on("error", (error: any) => {
          console.error(`Failed to write request payload to Python stdin: ${error.message}`);
          // Don't necessarily fail the whole thing if stdin write fails, 
          // but we should log it. The process might still be running.
        });
        try {
          proc.stdin.write(JSON.stringify(data));
        } catch (e: any) {
          console.error(`Error writing to stdin: ${e.message}`);
        }
      }
      proc.stdin.end();

      proc.stdout.on("data", (d: any) => dataString += d.toString());
      proc.stderr.on("data", (d: any) => errorString += d.toString());

      proc.on("error", (error: any) => {
        // This is handled by the initial spawn logic for fallback, 
        // but we keep it here as a safety net.
        if (responded) return;
        console.error(`Python process error: ${error.message}`);
      });

      proc.on("close", (code: number) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (responded || timedOut) return;

        if (code !== 0) {
          console.error(`Python process exited with code ${code}: ${errorString}`);
          return sendJsonError(500, { 
            error: "Evolution engine failed", 
            details: errorString || `Process exited with code ${code}` 
          });
        }
        
        const trimmedOutput = dataString.trim();
        if (!trimmedOutput) {
          console.error(`Python process returned empty output for mode ${mode}`);
          return sendJsonError(500, { error: "Evolution engine returned empty output" });
        }

        try {
          const result = JSON.parse(trimmedOutput);
          if (result.error) return sendJsonError(500, result);
          responded = true;
          res.json(result);
        } catch (e) {
          console.error(`Failed to parse Python output for mode ${mode}. Output length: ${dataString.length}`);
          console.error(`Output start: ${dataString.substring(0, 500)}`);
          console.error(`Output end: ${dataString.substring(dataString.length - 500)}`);
          sendJsonError(500, { 
            error: "Invalid output from evolution engine", 
            details: "The engine returned data that could not be parsed as JSON. This usually happens when the engine crashes or prints non-JSON warnings. Check server logs." 
          });
        }
      });
    }

    const startProcess = (cmd: string) => {
      try {
        const proc = spawn(cmd, args);
        
        proc.on("error", (err: any) => {
          if (responded) return;
          
          if (err.code === 'ENOENT' && cmd === 'python3') {
            console.warn("python3 not found, falling back to python");
            startProcess('python');
          } else {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            console.error(`Failed to start Python process (${cmd}): ${err.message}`);
            sendJsonError(500, { error: "Evolution engine failed to start", details: err.message });
          }
        });

        // Only setup handlers if we didn't immediately fail (though error event is async)
        setupProcessHandlers(proc);
        pythonProcess = proc;
      } catch (e: any) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error(`Exception during spawn: ${e.message}`);
        sendJsonError(500, { error: "Failed to spawn evolution engine", details: e.message });
      }
    };

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (pythonProcess) {
        try {
          pythonProcess.kill();
        } catch (error) {
          console.error("Failed to terminate timed-out Python process:", error);
        }
      }
      console.error(`Python ${mode} request timed out after ${requestTimeoutMs}ms`);
      sendJsonError(504, {
        error: `Evolution engine ${mode} request timed out.`,
        details: `The backend did not respond within ${Math.round(requestTimeoutMs / 1000)} seconds.`,
      });
    }, requestTimeoutMs);

    startProcess(pythonCmd);
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

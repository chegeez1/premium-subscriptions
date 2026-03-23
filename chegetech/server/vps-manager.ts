import { dbSettingsGet, dbSettingsSet } from "./storage";
import { Client as SshClient } from "ssh2";

const SETTINGS_KEY = "vps_servers";

export interface VpsServer {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  addedAt: string;
}

export type VpsStatus = "online" | "offline" | "unknown";

export interface VpsServerWithStatus extends VpsServer {
  status?: VpsStatus;
}

export class VpsManager {
  private load(): VpsServer[] {
    try {
      const raw = dbSettingsGet(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private save(servers: VpsServer[]): void {
    dbSettingsSet(SETTINGS_KEY, JSON.stringify(servers));
  }

  getAll(): VpsServer[] {
    return this.load();
  }

  getById(id: string): VpsServer | undefined {
    return this.load().find((s) => s.id === id);
  }

  add(data: Omit<VpsServer, "id" | "addedAt">): VpsServer {
    const servers = this.load();
    const server: VpsServer = {
      ...data,
      id: Math.random().toString(36).substring(2, 10),
      addedAt: new Date().toISOString(),
    };
    servers.push(server);
    this.save(servers);
    return server;
  }

  update(id: string, data: Partial<VpsServer>): VpsServer | null {
    const servers = this.load();
    const idx = servers.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    servers[idx] = { ...servers[idx], ...data };
    this.save(servers);
    return servers[idx];
  }

  delete(id: string): boolean {
    const servers = this.load();
    const idx = servers.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    servers.splice(idx, 1);
    this.save(servers);
    return true;
  }

  execCommand(server: VpsServer, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const conn = new SshClient();
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error("Connection timed out"));
      }, 15000);

      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            return reject(err);
          }
          let stdout = "";
          let stderr = "";
          stream.on("close", (code: number) => {
            clearTimeout(timeout);
            conn.end();
            resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
          });
          stream.on("data", (data: Buffer) => { stdout += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        });
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const connectConfig: any = {
        host: server.host,
        port: server.port || 22,
        username: server.username,
        readyTimeout: 12000,
      };
      if (server.authType === "key" && server.privateKey) {
        connectConfig.privateKey = server.privateKey;
      } else {
        connectConfig.password = server.password;
      }

      conn.connect(connectConfig);
    });
  }

  async reboot(id: string): Promise<{ success: boolean; message: string }> {
    const server = this.getById(id);
    if (!server) return { success: false, message: "Server not found" };
    try {
      await this.execCommand(server, "sudo reboot || reboot");
      return { success: true, message: "Reboot command sent successfully" };
    } catch (err: any) {
      if (err.message?.includes("closed") || err.message?.includes("ECONNRESET")) {
        return { success: true, message: "Reboot command sent (connection closed — server is rebooting)" };
      }
      return { success: false, message: err.message };
    }
  }

  async ping(id: string): Promise<{ success: boolean; uptime?: string; load?: string; memory?: string; disk?: string }> {
    const server = this.getById(id);
    if (!server) return { success: false };
    try {
      const { stdout } = await this.execCommand(
        server,
        "uptime -p 2>/dev/null; echo '---'; cat /proc/loadavg 2>/dev/null | awk '{print $1,$2,$3}'; echo '---'; free -h 2>/dev/null | awk 'NR==2{print $3\"/\"$2}'; echo '---'; df -h / 2>/dev/null | awk 'NR==2{print $5}'"
      );
      const parts = stdout.split("---").map((s) => s.trim());
      return {
        success: true,
        uptime: parts[0] || "unknown",
        load: parts[1] || "unknown",
        memory: parts[2] || "unknown",
        disk: parts[3] || "unknown",
      };
    } catch {
      return { success: false };
    }
  }
}

export const vpsManager = new VpsManager();

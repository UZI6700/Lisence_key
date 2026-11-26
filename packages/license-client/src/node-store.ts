import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { LicenseStorage } from './types';

export interface NodeLicenseStoreOptions {
  /** Application name used as the subdirectory in the OS application data folder. */
  appName?: string;
  /** Override the directory entirely (useful for portable installs/tests). */
  directory?: string;
  /** Make the file read-only after writing (POSIX 0444 / Windows +R). Default true. */
  readOnly?: boolean;
}

/**
 * Stores `license.lic` in the secure OS-specific application data directory:
 *   Windows: %APPDATA%\<appName>
 *   macOS:   ~/Library/Application Support/<appName>
 *   Linux:   $XDG_DATA_HOME/<appName> or ~/.local/share/<appName>
 *
 * Directory is 0700 and files are 0600 (0444 when readOnly is enabled).
 */
export class NodeLicenseStore implements LicenseStorage {
  readonly baseDir: string;
  private readonly readOnly: boolean;

  constructor(options: NodeLicenseStoreOptions = {}) {
    const name = (options.appName || 'LicenseManager').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const os = platform();
    let base = options.directory;
    if (!base) {
      if (os === 'win32') {
        base = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), name);
      } else if (os === 'darwin') {
        base = join(homedir(), 'Library', 'Application Support', name);
      } else {
        base = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), name);
      }
    }
    this.baseDir = base;
    this.readOnly = options.readOnly !== false;
  }

  readText(name: string): string | null {
    const path = this.pathFor(name);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  }

  writeText(name: string, content: string): void {
    const path = this.pathFor(name);
    mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    try { chmodSync(this.baseDir, 0o700); } catch { /* best effort on Windows */ }
    this.clearReadOnly(path);

    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, content, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    try { chmodSync(temp, 0o600); } catch { /* best effort */ }
    renameSync(temp, path);
    try { chmodSync(path, this.readOnly ? 0o444 : 0o600); } catch { /* best effort */ }
    if (this.readOnly && platform() === 'win32') this.windowsAttr(path, '+R');
  }

  remove(name: string): void {
    const path = this.pathFor(name);
    if (!existsSync(path)) return;
    this.clearReadOnly(path);
    unlinkSync(path);
  }

  private pathFor(name: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
      throw new Error('Invalid license storage file name');
    }
    return join(this.baseDir, name);
  }

  private clearReadOnly(path: string) {
    if (!existsSync(path)) return;
    try { chmodSync(path, 0o600); } catch { /* best effort */ }
    if (platform() === 'win32') this.windowsAttr(path, '-R');
  }

  private windowsAttr(path: string, flag: string) {
    try {
      execFileSync('attrib', [flag, path], { stdio: 'ignore', windowsHide: true });
    } catch {
      // NTFS ACLs and permissions vary; the Ed25519 signature is the real guard.
    }
  }
}

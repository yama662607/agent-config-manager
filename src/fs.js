import fs from 'node:fs/promises';
import path from 'node:path';
export async function writeFileAtomic(absolutePath, content) {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const tempPath = `${absolutePath}.tmp`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, absolutePath);
}
export async function readFileIfExists(absolutePath) {
    try {
        return await fs.readFile(absolutePath, 'utf8');
    }
    catch (error) {
        const maybeError = error;
        if (maybeError.code === 'ENOENT')
            return null;
        throw error;
    }
}
//# sourceMappingURL=fs.js.map
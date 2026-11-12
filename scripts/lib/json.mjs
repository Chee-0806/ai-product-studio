/** 读取 JSON 文件；缺失或格式错误时返回 null，由调用方决定如何报错。 */
import fs from 'node:fs';

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

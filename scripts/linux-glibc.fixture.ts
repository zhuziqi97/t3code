// Minimal ELF64 with a linked string table and a version NEEDS section, for both release CPUs.
export function glibcElfFixture(machine: number, version: string): Buffer {
  const strings = Buffer.from(`\0libc.so.6\0GLIBC_${version}\0`);
  const names = Buffer.from("\0.shstrtab\0.dynstr\0.gnu.version_r\0");
  const stringsOffset = 64;
  const namesOffset = stringsOffset + strings.length;
  const needsOffset = namesOffset + names.length;
  const sectionsOffset = needsOffset + 32;
  const elf = Buffer.alloc(sectionsOffset + 4 * 64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(elf);
  elf.writeUInt16LE(3, 16);
  elf.writeUInt16LE(machine, 18);
  elf.writeUInt32LE(1, 20);
  elf.writeBigUInt64LE(BigInt(sectionsOffset), 40);
  elf.writeUInt16LE(64, 52);
  elf.writeUInt16LE(64, 58);
  elf.writeUInt16LE(4, 60);
  elf.writeUInt16LE(1, 62);
  strings.copy(elf, stringsOffset);
  names.copy(elf, namesOffset);
  elf.writeUInt16LE(1, needsOffset);
  elf.writeUInt16LE(1, needsOffset + 2);
  elf.writeUInt32LE(1, needsOffset + 4);
  elf.writeUInt32LE(16, needsOffset + 8);
  elf.writeUInt16LE(2, needsOffset + 16 + 6);
  elf.writeUInt32LE(11, needsOffset + 16 + 8);
  for (const [index, name, type, offset, size, link] of [
    [1, 1, 3, namesOffset, names.length, 0],
    [2, 11, 3, stringsOffset, strings.length, 0],
    [3, 19, 0x6ffffffe, needsOffset, 32, 2],
  ] as const) {
    const section = sectionsOffset + index * 64;
    elf.writeUInt32LE(name, section);
    elf.writeUInt32LE(type, section + 4);
    elf.writeBigUInt64LE(BigInt(offset), section + 24);
    elf.writeBigUInt64LE(BigInt(size), section + 32);
    elf.writeUInt32LE(link, section + 40);
    elf.writeBigUInt64LE(1n, section + 48);
  }
  elf.writeUInt32LE(1, sectionsOffset + 3 * 64 + 44);
  return elf;
}

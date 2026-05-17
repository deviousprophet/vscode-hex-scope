#!/usr/bin/env node
/**
 * Generate a large Intel HEX test file (~24MB) with dummy ECU firmware data.
 * Usage: node generate-large-hex.js > firmware_24mb.hex
 */

const fs = require('fs');

// Configuration
const FILE_SIZE_MB = 24;
const BYTES_PER_LINE = 16;
const BYTES_TO_WRITE = FILE_SIZE_MB * 1024 * 1024;
const OUTPUT_FILE = 'sample/firmware_24mb.hex';

console.error(`Generating ${FILE_SIZE_MB}MB Intel HEX file...`);
console.error(`Output: ${OUTPUT_FILE}`);

const stream = fs.createWriteStream(OUTPUT_FILE);

// Helper: calculate Intel HEX checksum
function calculateChecksum(bytes) {
    const sum = bytes.reduce((a, b) => a + b, 0);
    return ((~sum) + 1) & 0xFF;
}

// Helper: write Intel HEX line
function writeHexLine(lineCount, address, data) {
    const byteCount = data.length;
    const recordType = 0x00; // Data record
    
    const header = Buffer.alloc(5);
    header[0] = byteCount;
    header.writeUInt16BE(address, 1);
    header[3] = recordType;
    header[4] = 0; // placeholder for checksum
    
    const allBytes = Buffer.concat([header, data]);
    const checksum = calculateChecksum(Array.from(allBytes));
    
    let line = ':';
    line += byteCount.toString(16).toUpperCase().padStart(2, '0');
    line += address.toString(16).toUpperCase().padStart(4, '0');
    line += recordType.toString(16).toUpperCase().padStart(2, '0');
    line += Array.from(data).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('');
    line += checksum.toString(16).toUpperCase().padStart(2, '0');
    
    stream.write(line + '\n');
}

// Special test patterns to inject at specific addresses
const testPatterns = [
    { address: 0x00001000, pattern: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), name: 'DEADBEEF' },
    { address: 0x00100000, pattern: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), name: 'DEADBEEF' },
    { address: 0x00500000, pattern: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), name: 'DEADBEEF' },
    { address: 0x01000000, pattern: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), name: 'DEADBEEF' },
    { address: 0x01500000, pattern: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]), name: 'DEADBEEF' },
];

console.error(`\nTest patterns to inject:`);
testPatterns.forEach(tp => {
    console.error(`  ${tp.name} at 0x${tp.address.toString(16).toUpperCase().padStart(8, '0')}`);
});
console.error('');

// Generate data
let currentAddress = 0x00000000;
let bytesWritten = 0;
let lineCount = 0;

// Create dummy data (cycling pattern for realism)
const dummyPattern = Buffer.from([0xAA, 0x55, 0xFF, 0x00, 0x12, 0x34, 0x56, 0x78]);

// Build a map of special pattern overrides
const patternOverrides = new Map();
testPatterns.forEach(tp => {
    for (let i = 0; i < tp.pattern.length; i++) {
        patternOverrides.set(tp.address + i, tp.pattern[i]);
    }
});

while (bytesWritten < BYTES_TO_WRITE) {
    // Extended Linear Address record if address exceeds 16-bit
    if ((currentAddress & 0xFFFF0000) !== ((currentAddress - 1) & 0xFFFF0000)) {
        const upperAddr = (currentAddress >>> 16) & 0xFFFF;
        const header = Buffer.alloc(2);
        header.writeUInt16BE(upperAddr, 0);
        const checksum = calculateChecksum([0x02, 0x00, 0x00, 0x04, ...Array.from(header)]);
        let line = ':020000040000';
        line = ':02000004' + upperAddr.toString(16).toUpperCase().padStart(4, '0');
        line += checksum.toString(16).toUpperCase().padStart(2, '0');
        stream.write(line + '\n');
    }

    // Write data line
    const bytesToWrite = Math.min(BYTES_PER_LINE, BYTES_TO_WRITE - bytesWritten);
    const data = Buffer.alloc(bytesToWrite);
    
    // Fill with cycling dummy pattern, but override with test patterns
    for (let i = 0; i < bytesToWrite; i++) {
        const addr = currentAddress + i;
        if (patternOverrides.has(addr)) {
            data[i] = patternOverrides.get(addr);
        } else {
            data[i] = dummyPattern[(bytesWritten + i) % dummyPattern.length];
        }
    }
    
    writeHexLine(lineCount, currentAddress & 0xFFFF, data);
    
    bytesWritten += bytesToWrite;
    currentAddress += bytesToWrite;
    lineCount++;
    
    // Progress indicator every 10MB
    if (bytesWritten % (10 * 1024 * 1024) === 0) {
        console.error(`  Written ${bytesWritten / 1024 / 1024}MB...`);
    }
}

// End of file record
const eofChecksum = calculateChecksum([0x00, 0x00, 0x00, 0x01]);
stream.write(`:00000001${eofChecksum.toString(16).toUpperCase().padStart(2, '0')}\n`);

stream.end(() => {
    console.error(`✓ Generated ${OUTPUT_FILE} (${(bytesWritten / 1024 / 1024).toFixed(1)}MB)`);
    console.error(`  Total lines: ${lineCount + 1}`);
});

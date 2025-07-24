//debug configuration parsing
import dotenv from 'dotenv';

dotenv.config();

console.log('Raw STREAM_SOURCES from env:', process.env.STREAM_SOURCES);
console.log('Type:', typeof process.env.STREAM_SOURCES);
console.log('Length:', process.env.STREAM_SOURCES?.length);

if (process.env.STREAM_SOURCES) {
  try {
    const parsed = JSON.parse(process.env.STREAM_SOURCES);
    console.log('Parsed successfully:', parsed);
    console.log('Number of sources:', parsed.length);
  } catch (e) {
    console.error('Parse error:', e.message);
  }
}
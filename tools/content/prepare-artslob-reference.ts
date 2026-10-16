import { prepareReferenceInventory, REFERENCE_FAILURE } from './artslob-reference.ts';

try {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const [source, destination] = args;
  if (args.length !== 2 || source === undefined || destination === undefined) throw new Error('invalid-arguments');
  const summary = prepareReferenceInventory(source, destination, process.cwd());
  console.log(JSON.stringify({ boundary: 'UNREVIEWED_REFERENCE_ONLY', summary }));
} catch {
  console.error(REFERENCE_FAILURE);
  process.exitCode = 1;
}

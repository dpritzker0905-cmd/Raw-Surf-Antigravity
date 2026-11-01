/* Run retained assertions unchanged, supplying only their missing Description double. */
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const choices={prior:'2026-10-28-saved-crew-repair/verify_saved_crew_ui.cjs',controls:'2026-10-29-saved-crew-controls/verify_controls.cjs',recovery:'2026-10-29-saved-crew-load-recovery/verify_recovery.cjs',order:'2026-10-29-saved-crew-request-order/verify_order.cjs'};
const selected=choices[process.argv[2]];assert(selected,'Choose prior, controls, recovery or order');const target=path.resolve(__dirname,'..',selected),original=fs.readFileSync(target,'utf8'),needle="DialogTitle:primitive('h2'),DialogFooter:";assert.strictEqual(original.split(needle).length-1,1,'Unexpected retained fixture import shape');
const compatible=original.replace(needle,"DialogTitle:primitive('h2'),DialogDescription:primitive('p'),DialogFooter:");
process.stderr.write('COMPATIBILITY: '+selected+'; one missing DialogDescription primitive added in memory; assertions/file bytes unchanged.\n');
const loaded=new Module(target,module);loaded.filename=target;loaded.paths=Module._nodeModulePaths(path.dirname(target));loaded._compile(compatible,target);

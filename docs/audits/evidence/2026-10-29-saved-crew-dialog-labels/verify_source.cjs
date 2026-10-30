/* Read-only exact-scope/handler invariants for this dialog-only repair. */
const fs=require('fs'),path=require('path'),assert=require('assert');
const req=require('module').createRequire('C:/Users/David/App/raw-surf/frontend/package.json'),parser=req('@babel/parser'),generate=req('@babel/generator').default;
const root=path.resolve(__dirname,'../../../..'),before=fs.readFileSync(path.join(__dirname,'baseline_SavedCrewSelector.js'),'utf8').replace(/\r\n/g,'\n'),after=fs.readFileSync(path.join(root,'frontend/src/components/SavedCrewSelector.js'),'utf8').replace(/\r\n/g,'\n');
function arrows(source){const result={};function walk(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id?.type==='Identifier'&&node.init?.type==='ArrowFunctionExpression')result[node.id.name]=generate(node.init,{comments:false,compact:true}).code;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value)}}walk(parser.parse(source,{sourceType:'module',plugins:['jsx']}));return result}
const old=arrows(before),current=arrows(after),names=['fetchSavedCrews','handleSelectCrew','handleSaveCurrentCrew','_handleSetDefault','handleDeleteCrew'];for(const name of names)assert.strictEqual(current[name],old[name],name+' changed');
assert(current.fetchSavedCrews.includes('apiClient.get(`/crews/saved`,{params:{user_id:user.id}})'),'Query changed');
function outside(source){return source.replace(/\{\/\* Save Dialog \*\/\}[\s\S]*?<\/Dialog>/g,'DIALOG').replace(', useId }',' }').replace(', DialogDescription,',',').replace('  const crewNameId = useId();\n','').replace('  const setDefaultId = useId();\n','')}
assert.strictEqual(outside(after),outside(before),'Outside-dialog code changed beyond new hooks/imports');
console.log(JSON.stringify({passed:7,total:7,handlers_unchanged:names,query_unchanged:true,outside_dialog_unchanged_except_hooks_imports:true},null,2));

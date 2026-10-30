import {pythonJsonExpression} from './python-data.js';
// A log write can never open an application on the show machine.
export function logScript(log,filename){
 if(!/^DPD_Plugin_[A-Za-z0-9_.-]+\.log$/.test(filename))throw Error('Invalid log filename.');
 const payload=pythonJsonExpression({log,filename});
 return `import os, json, tempfile\npayload = ${payload}\nfolder = os.path.join(tempfile.gettempdir(), 'DPD-Plugin-Logs')\nif not os.path.isdir(folder):\n    try:\n        os.makedirs(folder)\n    except OSError:\n        if not os.path.isdir(folder):\n            raise\nfilename = os.path.join(folder, payload['filename'])\nwith open(filename, 'wb') as handle:\n    handle.write(payload['log'].encode('utf-8'))\nreturn {'path': filename, 'folder': folder}`;
}
// Per-run bounded snapshot, flushed in batches; never telemetry polling.
export class AutoLog{
 constructor({request,text,onStatus=()=>{}}){Object.assign(this,{request,text,onStatus});this.filename='DPD_Plugin_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+Math.random().toString(36).slice(2,8)+'.log';this.last=null;this.pending=null;this.timer=null;}
 start(){if(this.timer)return;this.flush();this.timer=setInterval(()=>this.flush(),10000);}
 flush(){
  if(this.pending)return this.pending;
  const text=this.text();if(text===this.last)return Promise.resolve();
  this.pending=(async()=>{try{
   const response=await this.request(logScript(text,this.filename));
   const result=typeof response.returnValue==='string'?JSON.parse(response.returnValue):response.returnValue;
   if(!result?.path)throw Error('Designer did not confirm writing the log.');
   this.last=text;this.onStatus({path:result.path,folder:result.folder,error:''});
  }catch(error){this.onStatus({path:'',error:'Automatic log: '+String(error.message||error)});}
  finally{this.pending=null;}})();return this.pending;
 }
 stop(){clearInterval(this.timer);this.timer=null;}
}
export async function saveLog(log,{target=window}={}){
 const filename='DPD_Plugin_'+new Date().toISOString().replace(/[:.]/g,'-')+'.log';
 const url=target.URL.createObjectURL(new target.Blob([log],{type:'text/plain;charset=utf-8'}));
 const a=target.document.createElement('a');a.href=url;a.download=filename;target.document.body.append(a);a.click();a.remove();
 target.setTimeout(()=>target.URL.revokeObjectURL(url),30000);
 return {kind:'download',filename};
}
export async function copyLog(log,target=window){
 if(target.navigator.clipboard?.writeText){try{await target.navigator.clipboard.writeText(log);return;}catch(_){}}
 const area=target.document.createElement('textarea');area.value=log;area.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01';target.document.body.append(area);area.focus();area.select();
 let copied=false;try{copied=target.document.execCommand('copy');}finally{area.remove();}
 if(!copied)throw Error('Clipboard unavailable. Select text in Event log and copy it manually.');
}

(function(){
  "use strict";

  function scalar(value){
    const raw=String(value||"").trim();
    if((raw.startsWith('"')&&raw.endsWith('"'))||(raw.startsWith("'")&&raw.endsWith("'"))){
      if(raw.startsWith('"')){try{return JSON.parse(raw);}catch{throw new Error("Front matter contains an invalid quoted value.");}}
      return raw.slice(1,-1).replace(/''/g,"'");
    }
    return raw;
  }

  function parseDocument(source){
    const value=String(source||"").replace(/^\uFEFF/,"");
    const match=value.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/);
    if(!match)throw new Error("Markdown must start with a valid --- front matter block.");
    const meta={};
    for(const line of match[1].split(/\r?\n/)){
      if(!line.trim()||line.trim().startsWith("#"))continue;
      const field=line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if(!field)throw new Error(`Invalid front matter line: ${line}`);
      if(Object.hasOwn(meta,field[1]))throw new Error(`Duplicate front matter field: ${field[1]}`);
      meta[field[1]]=scalar(field[2]);
    }
    const body=match[2].trim();
    if(String(meta.schemaVersion)!=="1")throw new Error("Markdown schemaVersion must be 1.");
    if(!/^[a-zA-Z0-9._-]{1,100}$/.test(String(meta.bookId||"")))throw new Error("Markdown requires a valid bookId.");
    if(meta.field!=="longSummary")throw new Error('Markdown field must be "longSummary".');
    if(!body)throw new Error("The extended summary body is empty.");
    if(body.length>30000)throw new Error("The extended summary exceeds 30,000 characters.");
    return{meta,body};
  }

  function documentFor(book){
    const quote=(value)=>JSON.stringify(String(value||""));
    return`---\nschemaVersion: 1\nbookId: ${quote(book.id)}\nbookTitle: ${quote(book.title)}\nauthor: ${quote(book.author)}\nfield: "longSummary"\n---\n\n${String(book.longSummary||"").trim()}\n`;
  }

  function safeHref(raw){
    const value=String(raw||"").trim();
    if(value.startsWith("#")||value.startsWith("/"))return value;
    try{const url=new URL(value,location.href);return["http:","https:"].includes(url.protocol)?url.href:"";}catch{return"";}
  }

  function appendInline(target,value){
    const source=String(value||"");
    const token=/(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*([^*\n]+)\*|_([^_\n]+)_)/g;
    let cursor=0,match;
    while((match=token.exec(source))){
      if(match.index>cursor)target.append(document.createTextNode(source.slice(cursor,match.index)));
      let node;
      if(match[2]!==undefined||match[3]!==undefined){node=document.createElement("strong");node.textContent=match[2]??match[3];}
      else if(match[4]!==undefined){node=document.createElement("code");node.textContent=match[4];}
      else if(match[5]!==undefined){const href=safeHref(match[6]);if(href){node=document.createElement("a");node.href=href;node.textContent=match[5];node.rel="noopener noreferrer";}else node=document.createTextNode(match[5]);}
      else{node=document.createElement("em");node.textContent=match[7]??match[8];}
      target.append(node);cursor=token.lastIndex;
    }
    if(cursor<source.length)target.append(document.createTextNode(source.slice(cursor)));
  }

  function render(container,source){
    container.replaceChildren();
    const lines=String(source||"").replace(/\r\n?/g,"\n").split("\n");
    const headings=[],headingIds=new Map();
    let paragraph=[],list=null,listType="",quote=[],code=[],inCode=false;
    const flushParagraph=()=>{if(!paragraph.length)return;const p=document.createElement("p");appendInline(p,paragraph.join(" "));container.append(p);paragraph=[];};
    const flushList=()=>{list=null;listType="";};
    const flushQuote=()=>{if(!quote.length)return;const block=document.createElement("blockquote"),p=document.createElement("p");appendInline(p,quote.join(" "));block.append(p);container.append(block);quote=[];};
    const flushCode=()=>{if(!code.length)return;const pre=document.createElement("pre"),node=document.createElement("code");node.textContent=code.join("\n");pre.append(node);container.append(pre);code=[];};
    const flush=()=>{flushParagraph();flushList();flushQuote();};
    for(const line of lines){
      if(/^\s*```/.test(line)){if(inCode){flushCode();inCode=false;}else{flush();inCode=true;}continue;}
      if(inCode){code.push(line);continue;}
      if(!line.trim()){flush();continue;}
      const heading=line.match(/^\s*(#{1,4})\s+(.+)$/);if(heading){flush();const level=heading[1].length,text=heading[2].trim(),node=document.createElement(`h${level}`);appendInline(node,text);if(level===2||level===3){const base=text.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"section",count=(headingIds.get(base)||0)+1;headingIds.set(base,count);node.id=`summary-${base}${count>1?`-${count}`:""}`;headings.push({level,text,id:node.id});}container.append(node);continue;}
      if(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)){flush();container.append(document.createElement("hr"));continue;}
      const item=line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);if(item){flushParagraph();flushQuote();const type=item[2]?"ol":"ul";if(!list||listType!==type){flushList();list=document.createElement(type);listType=type;container.append(list);}const li=document.createElement("li");appendInline(li,item[3]);list.append(li);continue;}
      const quoted=line.match(/^\s*>\s?(.*)$/);if(quoted){flushParagraph();flushList();quote.push(quoted[1]);continue;}
      flushList();flushQuote();paragraph.push(line.trim());
    }
    if(inCode)flushCode();flush();
    return headings;
  }

  window.ShelfNotesMarkdown={parseDocument,documentFor,render};
})();

(() => {
  const cfg = window.MICROJOB_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const $ = id => document.getElementById(id);
  let supabase = null, currentUser = null, profile = null, signupMode = false, selectedTask = null;

  const money = paisa => new Intl.NumberFormat("bn-BD",{style:"currency",currency:"BDT",minimumFractionDigits:2}).format((Number(paisa)||0)/100);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const statusBn = status => ({pending:"পর্যালোচনাধীন",approved:"অনুমোদিত",rejected:"বাতিল",paid:"পেমেন্ট সম্পন্ন",published:"প্রকাশিত",closed:"বন্ধ",draft:"খসড়া"}[status] || status);
  function message(id, text, error=false){ const el=$(id); if(el){el.textContent=text||"";el.style.color=error?"#b42318":"#0f766e";} }
  function toast(text){const el=$("toast");el.textContent=text;el.classList.remove("hidden");setTimeout(()=>el.classList.add("hidden"),3000);}
  function showTab(tab){document.querySelectorAll(".tabpage").forEach(el=>el.classList.add("hidden"));$("tab-"+tab)?.classList.remove("hidden");document.querySelectorAll("[data-tab]").forEach(el=>el.classList.toggle("active",el.dataset.tab===tab));}
  function configWarning(){ $("setupNotice").textContent="প্রথমে config.js ফাইলে Supabase Project URL ও publishable/anon key বসান। Secret বা service_role key কখনো এখানে দেবেন না।";$("setupNotice").classList.remove("hidden"); }
  if(!configured){configWarning();$("authPanel").classList.remove("hidden");$("authSubmit").disabled=true;return;}
  if(!window.supabase){configWarning();return;}
  supabase = window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);

  $("showLogin").addEventListener("click",()=>setAuthMode(false));
  $("showSignup").addEventListener("click",()=>setAuthMode(true));
  function setAuthMode(signup){signupMode=signup;$("showLogin").classList.toggle("active",!signup);$("showSignup").classList.toggle("active",signup);$("nameLabel").classList.toggle("hidden",!signup);$("displayName").required=signup;$("authSubmit").textContent=signup?"অ্যাকাউন্ট তৈরি করুন":"লগইন";$("password").autocomplete=signup?"new-password":"current-password";message("authMessage","");}
  $("authForm").addEventListener("submit",async e=>{
    e.preventDefault();const btn=$("authSubmit");btn.disabled=true;message("authMessage","অনুগ্রহ করে অপেক্ষা করুন...");
    try{
      const email=$("email").value.trim(),password=$("password").value;
      if(signupMode){
        const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:$("displayName").value.trim()||"User"}}});
        if(error)throw error;
        message("authMessage",data.session?"অ্যাকাউন্ট তৈরি হয়েছে।":"অ্যাকাউন্ট তৈরি হয়েছে। ইমেইল যাচাই করে তারপর লগইন করুন।");
      }else{
        const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
      }
    }catch(err){message("authMessage",err.message||"অনুরোধ সম্পন্ন হয়নি।",true);}finally{btn.disabled=false;}
  });
  $("logoutBtn").addEventListener("click",async()=>{await supabase.auth.signOut();});
  document.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>{showTab(btn.dataset.tab);if(btn.dataset.tab==="wallet")loadWallet();if(btn.dataset.tab==="mywork")loadSubmissions();if(btn.dataset.tab==="admin")loadAdmin();}));
  $("refreshTasks").addEventListener("click",loadTasks);$("refreshAdmin").addEventListener("click",loadAdmin);

  async function loadProfile(){
    let {data,error}=await supabase.from("profiles").select("id,display_name,role").eq("id",currentUser.id).maybeSingle();
    if(error)throw error;
    if(!data){const {error:insertError}=await supabase.from("profiles").insert({id:currentUser.id,display_name:currentUser.user_metadata?.display_name||"User"});if(insertError)throw insertError;({data,error}=await supabase.from("profiles").select("id,display_name,role").eq("id",currentUser.id).single());if(error)throw error;}
    profile=data;
  }
  async function renderSession(session){
    currentUser=session?.user||null;
    $("authPanel").classList.toggle("hidden",!!currentUser);$("appPanel").classList.toggle("hidden",!currentUser);$("logoutBtn").classList.toggle("hidden",!currentUser);
    if(!currentUser){profile=null;return;}
    try{
      await loadProfile();$("helloName").textContent="স্বাগতম, "+(profile.display_name||"User");$("adminTab").classList.toggle("hidden",profile.role!=="admin");
      await loadTasks();await loadWallet();
    }catch(err){toast("প্রোফাইল লোড হয়নি: "+(err.message||"ত্রুটি"));}
  }
  async function loadTasks(){
    const root=$("taskList");root.innerHTML='<p class="muted">কাজ লোড হচ্ছে...</p>';
    const {data,error}=await supabase.from("tasks").select("id,title,description,category,reward_paisa").eq("status","published").order("created_at",{ascending:false});
    if(error){root.textContent=error.message;return;}
    if(!data?.length){root.innerHTML='<div class="notice">এখন কোনো প্রকাশিত কাজ নেই। পরে আবার দেখুন।</div>';return;}
    root.innerHTML=data.map(t=>`<article class="task-card"><span class="pill">${escapeHtml(t.category.replaceAll("_"," "))}</span><h3>${escapeHtml(t.title)}</h3><p class="muted">${escapeHtml(t.description.slice(0,180))}${t.description.length>180?"…":""}</p><p class="reward">${money(t.reward_paisa)}</p><button class="primary" data-task="${t.id}">কাজ জমা দিন</button></article>`).join("");
    root.querySelectorAll("[data-task]").forEach(btn=>btn.addEventListener("click",()=>{selectedTask=data.find(t=>String(t.id)===btn.dataset.task);$("submitTaskId").value=selectedTask.id;$("submitTaskTitle").textContent=selectedTask.title;$("submitTaskDescription").textContent=selectedTask.description;$("proofUrl").value="";$("answerText").value="";message("submissionMessage","");$("submitDialog").showModal();}));
  }
  $("cancelSubmission").addEventListener("click",()=>$("submitDialog").close());
  $("submissionForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!currentUser)return;
    const proof=$("proofUrl").value.trim();if(proof && !/^https:\/\//i.test(proof)){message("submissionMessage","প্রমাণের লিংক HTTPS হতে হবে।",true);return;}
    const payload={task_id:Number($("submitTaskId").value),user_id:currentUser.id,proof_url:proof||null,answer_text:$("answerText").value.trim(),status:"pending"};
    const {error}=await supabase.from("submissions").insert(payload);
    if(error){message("submissionMessage",error.code==="23505"?"আপনি এই কাজটি আগে জমা দিয়েছেন।":error.message,true);return;}
    $("submitDialog").close();toast("কাজ জমা হয়েছে; অ্যাডমিন যাচাই করবেন।");loadSubmissions();
  });
  async function loadSubmissions(){
    const root=$("submissionList");root.innerHTML='<p class="muted">লোড হচ্ছে...</p>';
    const {data,error}=await supabase.from("submissions").select("id,task_id,status,answer_text,created_at,tasks(title,reward_paisa)").order("created_at",{ascending:false});
    if(error){root.textContent=error.message;return;}
    root.innerHTML=data?.length?data.map(s=>`<div class="item-card"><div class="row"><strong>${escapeHtml(s.tasks?.title||"কাজ #"+s.task_id)}</strong><span class="status ${escapeHtml(s.status)}">${statusBn(s.status)}</span></div><p class="muted">${escapeHtml(s.answer_text||"")}</p><p>${money(s.tasks?.reward_paisa||0)}</p></div>`).join(""):'<p class="muted">এখনো কোনো কাজ জমা দেননি।</p>';
  }
  async function loadWallet(){
    const {data,error}=await supabase.rpc("get_my_wallet");
    if(error){$("balance").textContent="—";message("withdrawMessage","ওয়ালেট লোড হয়নি। SQL migration প্রয়োগ করা হয়েছে কি না দেখুন।",true);}
    else $("balance").textContent=money(data);
    const [{data:tx,error:txErr},{data:ws,error:wErr}]=await Promise.all([
      supabase.from("wallet_transactions").select("id,amount_paisa,transaction_type,reference,created_at").order("created_at",{ascending:false}).limit(30),
      supabase.from("withdrawals").select("id,amount_paisa,method,status,created_at").order("created_at",{ascending:false}).limit(30)
    ]);
    $("transactionList").innerHTML=txErr?'<p class="muted">লেনদেন লোড হয়নি।</p>':tx?.length?tx.map(t=>`<div class="item-card"><div class="row"><strong>${t.transaction_type==="credit"?"আয়":"ডেবিট"}</strong><span>${t.transaction_type==="credit"?"+":"−"}${money(t.amount_paisa)}</span></div><p class="muted">${escapeHtml(t.reference)} · ${new Date(t.created_at).toLocaleDateString("bn-BD")}</p></div>`).join(""):'<p class="muted">কোনো লেনদেন নেই।</p>';
    $("withdrawalList").innerHTML=wErr?'<p class="muted">অনুরোধ লোড হয়নি।</p>':ws?.length?ws.map(w=>`<div class="item-card"><div class="row"><strong>${money(w.amount_paisa)} · ${w.method==="bkash"?"বিকাশ":"নগদ"}</strong><span class="status ${escapeHtml(w.status)}">${statusBn(w.status)}</span></div></div>`).join(""):'<p class="muted">কোনো উত্তোলনের অনুরোধ নেই।</p>';
  }
  $("withdrawForm").addEventListener("submit",async e=>{
    e.preventDefault();const amount=Math.round(Number($("withdrawAmount").value)*100);const account=$("withdrawAccount").value.replace(/[\s-]/g,"");
    if(!Number.isSafeInteger(amount)||amount<5000){message("withdrawMessage","সর্বনিম্ন উত্তোলন ৳৫০।",true);return;}
    if(!/^01[3-9]\d{8}$/.test(account)){message("withdrawMessage","বাংলাদেশের সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন।",true);return;}
    const {error}=await supabase.rpc("request_withdrawal",{p_amount_paisa:amount,p_method:$("withdrawMethod").value,p_account_number:account});
    if(error){message("withdrawMessage",error.message||"অনুরোধ ব্যর্থ হয়েছে।",true);return;}
    message("withdrawMessage","অনুরোধ জমা হয়েছে। অ্যাডমিন যাচাই করবেন।");$("withdrawForm").reset();await loadWallet();
  });
  $("taskForm").addEventListener("submit",async e=>{
    e.preventDefault();const reward=Math.round(Number($("taskReward").value)*100);
    if(!Number.isSafeInteger(reward)||reward<=0){message("taskCreateMessage","সঠিক পারিশ্রমিক লিখুন।",true);return;}
    const {data,error}=await supabase.rpc("admin_create_task",{p_title:$("taskTitle").value.trim(),p_description:$("taskDescription").value.trim(),p_category:$("taskCategory").value,p_reward_paisa:reward});
    if(error){message("taskCreateMessage",error.message,true);return;}
    message("taskCreateMessage","কাজ প্রকাশ হয়েছে।");$("taskForm").reset();await loadTasks();
  });
  async function loadAdmin(){
    if(profile?.role!=="admin"){toast("অ্যাডমিন অনুমতি নেই।");return;}
    const root=$("adminSubmissions");root.innerHTML='<p class="muted">লোড হচ্ছে...</p>';
    const {data,error}=await supabase.from("submissions").select("id,user_id,task_id,status,answer_text,proof_url,created_at,tasks(title,reward_paisa)").eq("status","pending").order("created_at",{ascending:true});
    if(error){root.textContent=error.message;}else root.innerHTML=data?.length?data.map(s=>`<div class="item-card"><strong>${escapeHtml(s.tasks?.title||"কাজ #"+s.task_id)}</strong><p class="muted">ইউজার: ${escapeHtml(s.user_id)} · জমা #${s.id}</p><p>${escapeHtml(s.answer_text||"")}</p>${s.proof_url?`<p><a href="${escapeHtml(s.proof_url)}" target="_blank" rel="noopener noreferrer">প্রমাণ দেখুন</a></p>`:""}<p class="reward">${money(s.tasks?.reward_paisa||0)}</p><div class="row"><button class="primary" data-review="${s.id}" data-approve="true">অনুমোদন + ক্রেডিট</button><button class="secondary" data-review="${s.id}" data-approve="false">বাতিল</button></div></div>`).join(""):'<p class="muted">পর্যালোচনার জন্য কোনো কাজ নেই।</p>';
    root.querySelectorAll("[data-review]").forEach(btn=>btn.addEventListener("click",async()=>{if(!confirm(btn.dataset.approve==="true"?"কাজ অনুমোদন করে ওয়ালেটে আয় যোগ করবেন?":"কাজটি বাতিল করবেন?"))return;const {error}=await supabase.rpc("admin_review_submission",{p_submission_id:Number(btn.dataset.review),p_approve:btn.dataset.approve==="true"});if(error){toast(error.message);return;}toast("সিদ্ধান্ত সংরক্ষণ হয়েছে।");await loadAdmin();await loadWallet();}));
    const {data:ws,error:wErr}=await supabase.from("withdrawals").select("id,user_id,amount_paisa,method,account_number,status,created_at").eq("status","pending").order("created_at",{ascending:true});
    const wr=$("adminWithdrawals");
    if(wErr){wr.textContent=wErr.message;}else wr.innerHTML=ws?.length?ws.map(w=>`<div class="item-card"><strong>${money(w.amount_paisa)} · ${w.method==="bkash"?"বিকাশ":"নগদ"}</strong><p class="muted">ইউজার: ${escapeHtml(w.user_id)}</p><p>পেমেন্ট নম্বর: <strong>${escapeHtml(w.account_number)}</strong></p><div class="row"><button class="primary" data-withdraw="${w.id}" data-state="paid">পেমেন্ট সম্পন্ন</button><button class="secondary" data-withdraw="${w.id}" data-state="rejected">বাতিল</button></div></div>`).join(""):'<p class="muted">পেন্ডিং উত্তোলন নেই।</p>';
    wr.querySelectorAll("[data-withdraw]").forEach(btn=>btn.addEventListener("click",async()=>{if(!confirm(btn.dataset.state==="paid"?"বিকাশ/নগদে টাকা পাঠানো হয়েছে নিশ্চিত করে চিহ্নিত করবেন?":"উত্তোলনের অনুরোধ বাতিল করবেন?"))return;const {error}=await supabase.rpc("admin_finalize_withdrawal",{p_withdrawal_id:Number(btn.dataset.withdraw),p_result:btn.dataset.state});if(error){toast(error.message);return;}toast("উত্তোলনের অবস্থা আপডেট হয়েছে।");await loadAdmin();await loadWallet();}));
  }
  supabase.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>renderSession(session),0);});
  supabase.auth.getSession().then(({data})=>renderSession(data.session));
})();

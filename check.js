
    let currentFriend=1,currentPage='dashboard',currentSessionType='study',timerInterval=null,timerSeconds=0,isTimerRunning=false,pomodoroMode=false,focusActive=false,calMonth=new Date().getMonth(),calYear=new Date().getFullYear(),undoStack=[];

    // Audio context for sounds
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    let audioCtx;
    function playSound(type){
        try{
        if(!audioCtx)audioCtx=new AudioCtx();
        const o=audioCtx.createOscillator(),g=audioCtx.createGain();
        o.connect(g);g.connect(audioCtx.destination);
        if(type==='start'){o.frequency.value=520;o.type='sine';g.gain.value=0.1;o.start();o.stop(audioCtx.currentTime+0.1)}
        else if(type==='stop'){o.frequency.value=300;o.type='square';g.gain.value=0.08;o.start();o.stop(audioCtx.currentTime+0.15)}
        else if(type==='done'){o.frequency.value=880;o.type='sine';g.gain.value=0.12;o.start();o.stop(audioCtx.currentTime+0.3)}
        else if(type==='levelup'){o.frequency.value=660;o.type='sine';g.gain.value=0.1;o.start();setTimeout(()=>{o.frequency.value=880},150);o.stop(audioCtx.currentTime+0.3)}
        }catch(e){}
    }

    function loadData(){
        const s=localStorage.getItem('friendsTracker');
        if(s){const p=JSON.parse(s);p.friendCodes=p.friendCodes||{};p.friendUids=p.friendUids||{};p.messages=p.messages||[];p.reminders=p.reminders||[];p.moods=p.moods||{};p.challenges=p.challenges||[];p.schedule=p.schedule||[];p.dailyTarget=p.dailyTarget||4;p.notes=p.notes||[];return p}
        return{friends:{1:{name:'You',activities:[],sessions:[],goals:[],streak:0,lastActive:null,myCode:null,xp:0,level:1,badges:[],streakFreezes:0}},friendCodes:{},friendUids:{},messages:[],reminders:[],moods:{},challenges:[],schedule:[],dailyTarget:4,notes:[]}
    }
    function saveData(d){localStorage.setItem('friendsTracker',JSON.stringify(d));syncToFirebase()}
    let data=loadData();

    // ===== FIREBASE SYNC =====
    const firebaseConfig={
        apiKey:"AIzaSyB4n2adhczkNsr4DUw7jR_EFL129SyRzgQ",
        authDomain:"khet-diary-76200.firebaseapp.com",
        databaseURL:"https://khet-diary-76200-default-rtdb.firebaseio.com",
        projectId:"khet-diary-76200",
        storageBucket:"khet-diary-76200.firebasestorage.app",
        messagingSenderId:"184564195930",
        appId:"1:184564195930:web:a7762d3aeb7773c8bdae63"
    };
    let fbDb=null,fbAuth=null,syncEnabled=false;
    let currentUid=null;
    function initFirebase(){
        try{
            if(typeof firebase==='undefined')return;
            firebase.initializeApp(firebaseConfig);
            fbDb=firebase.database();
            fbAuth=firebase.auth();
            syncEnabled=true;
            updateSyncStatus('connected');
            fbAuth.onAuthStateChanged(user=>{
                if(user){
                    currentUid=user.uid;
                    loadUserData(user.uid);
                }else{
                    currentUid=null;
                    showLoginPage();
                }
            });
        }catch(e){console.log('Firebase init failed:',e);updateSyncStatus('error');showLoginPage()}
    }
    function updateSyncStatus(status){
        const el=document.getElementById('syncStatus');if(!el)return;
        if(status==='connected')el.innerHTML='<i class="fas fa-cloud" style="color:var(--success)"></i> Synced';
        else if(status==='syncing')el.innerHTML='<i class="fas fa-sync fa-spin" style="color:var(--warning)"></i>';
        else if(status==='error')el.innerHTML='<i class="fas fa-cloud" style="color:var(--danger)"></i> Offline';
        else el.innerHTML='<i class="fas fa-cloud" style="color:var(--muted)"></i> Local';
    }
    // Sync using UID
    function syncToFirebase(){
        if(!syncEnabled||!fbDb||!currentUid)return;
        updateSyncStatus('syncing');
        try{
            const syncData=JSON.parse(JSON.stringify(data));
            syncData.syncTimestamp=Date.now();
            fbDb.ref('users/'+currentUid).set(syncData).then(()=>updateSyncStatus('connected')).catch(()=>updateSyncStatus('error'));
        }catch(e){updateSyncStatus('error')}
    }
    function loadUserData(uid){
        if(!fbDb)return;
        fbDb.ref('users/'+uid).once('value').then(snap=>{
            const remote=snap.val();
            if(remote&&remote.friends){
                data=remote;
            }
            localStorage.setItem('friendsTracker',JSON.stringify(data));
            const ids=Object.keys(data.friends);if(ids.length>0)currentFriend=parseInt(ids[0]);
            renderFriendToggle();renderAll();
            listenFromFirebase();
        }).catch(()=>{showMainApp()});
    }
    function listenFromFirebase(){
        if(!fbDb||!currentUid)return;
        // Listen for own data changes
        fbDb.ref('users/'+currentUid).on('value',snap=>{
            const remote=snap.val();
            if(remote&&remote.friends){
                const oldTs=data.syncTimestamp||0;
                if(remote.syncTimestamp>oldTs){
                    data=remote;
                    localStorage.setItem('friendsTracker',JSON.stringify(data));
                    const ids=Object.keys(data.friends);if(ids.length>0)currentFriend=parseInt(ids[0]);
                    renderFriendToggle();renderAll();
                }
            }
        });
        // Listen for friend data (by friend's UID stored in friendUids)
        Object.keys(data.friendUids||{}).forEach(friendUid=>{
            if(friendUid===currentUid)return;
            fbDb.ref('users/'+friendUid).on('value',snap=>{
                const remote=snap.val();
                if(remote&&remote.friends&&remote.friends[1]){
                    const fid=data.friendUids[friendUid];
                    if(fid){
                        data.friends[fid]={...remote.friends[1],uid:friendUid};
                        localStorage.setItem('friendsTracker',JSON.stringify(data));
                        renderAll();
                        // Check notifications
                        if(remote.notifications){
                            Object.values(remote.notifications).forEach(n=>{
                                if(n.to===currentUid&&!(data.notifications||[]).find(x=>x.id===n.id)){
                                    if(!data.notifications)data.notifications=[];
                                    data.notifications.push(n);
                                    showNotif(n.title,n.message);
                                    localStorage.setItem('friendsTracker',JSON.stringify(data));
                                }
                            });
                        }
                    }
                }
            });
        });
        // Listen for incoming friend requests â€” auto-add them
        fbDb.ref('users/'+currentUid+'/incomingFriends').on('child_added',snap=>{
            const req=snap.val();
            if(!req||!req.uid||req.uid===currentUid)return;
            // Check if already added
            const alreadyExists=Object.values(data.friendUids||{}).some(fid=>data.friends[fid]&&data.friends[fid].uid===req.uid);
            if(alreadyExists)return;
            // Auto-add this friend
            const ids=Object.keys(data.friends).map(Number),newId=ids.length?Math.max(...ids)+1:2;
            data.friends[newId]={
                name:req.name||'Friend',code:req.code||'',uid:req.uid,
                activities:[],sessions:[],goals:[],streak:0,lastActive:null,
                xp:0,level:1,badges:[],streakFreezes:0,addedAt:new Date().toISOString()
            };
            if(!data.friendCodes)data.friendCodes={};
            if(req.code)data.friendCodes[req.code]=newId;
            if(!data.friendUids)data.friendUids={};
            data.friendUids[req.uid]=newId;
            localStorage.setItem('friendsTracker',JSON.stringify(data));
            renderFriendToggle();renderAll();
            showNotif('ðŸ‘‹ New Friend!',req.name+' added you as a friend!');
            // Confirm back to the requester
            fbDb.ref('users/'+req.uid+'/friendConfirmations/'+currentUid).set({name:data.friends[1].name,uid:currentUid,time:Date.now()});
        });
        // Listen for friend confirmations
        fbDb.ref('users/'+currentUid+'/friendConfirmations').on('child_added',snap=>{
            const conf=snap.val();
            if(!conf||!conf.uid)return;
            const alreadyExists=Object.values(data.friendUids||{}).some(fid=>data.friends[fid]&&data.friends[fid].uid===conf.uid);
            if(alreadyExists)return;
            // Add the confirming friend
            const ids=Object.keys(data.friends).map(Number),newId=ids.length?Math.max(...ids)+1:2;
            data.friends[newId]={
                name:conf.name||'Friend',code:'',uid:conf.uid,
                activities:[],sessions:[],goals:[],streak:0,lastActive:null,
                xp:0,level:1,badges:[],streakFreezes:0,addedAt:new Date().toISOString()
            };
            if(!data.friendUids)data.friendUids={};
            data.friendUids[conf.uid]=newId;
            localStorage.setItem('friendsTracker',JSON.stringify(data));
            renderFriendToggle();renderAll();
            showNotif('ðŸ‘‹ Friend Connected!',conf.name+' is now your friend!');
        });
    }
    function connectFriendByUid(friendUid){
        if(!fbDb)return Promise.resolve(null);
        return fbDb.ref('users/'+friendUid).once('value').then(snap=>{
            const remote=snap.val();
            if(remote&&remote.friends&&remote.friends[1])return remote.friends[1].name;
            return null;
        });
    }
    function pushNotificationToFriends(type,title,message){
        if(!syncEnabled||!fbDb||!currentUid)return;
        const notif={id:Date.now(),from:currentUid,fromName:data.friends[1].name,type,title,message,time:new Date().toISOString()};
        Object.keys(data.friendUids||{}).forEach(friendUid=>{
            if(friendUid===currentUid)return;
            fbDb.ref('users/'+friendUid+'/notifications/'+notif.id).set({...notif,to:friendUid});
        });
    }

    // ===== AUTH FUNCTIONS =====
    function showLoginPage(){
        document.getElementById('loginPage').style.display='flex';
        document.getElementById('mainApp').style.display='none';
        document.getElementById('loadingScreen').style.display='none';
    }
    function showMainApp(){
        document.getElementById('loginPage').style.display='none';
        document.getElementById('mainApp').style.display='block';
        document.getElementById('loadingScreen').style.display='none';
        const ids=Object.keys(data.friends);if(ids.length>0)currentFriend=parseInt(ids[0]);
        renderFriendToggle();renderAll();requestNotificationPermission();scheduleReminders();
        // Set avatar
        const av=document.getElementById('userAvatar');
        const avatarData=data.friends[1].avatar;
        if(avatarData&&avatarData.startsWith('data:')){
            av.innerHTML='<img src="'+avatarData+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
        }else if(avatarData){
            av.innerHTML='<span>'+avatarData+'</span>';
        }else{
            const user=fbAuth?fbAuth.currentUser:null;
            av.textContent=user?(user.displayName||user.email||'?')[0].toUpperCase():'?';
        }
    }
    function showLoading(){document.getElementById('loginPage').style.display='none';document.getElementById('mainApp').style.display='none';document.getElementById('loadingScreen').style.display='flex'}
    function showLoginTab(tab){
        document.querySelectorAll('.login-tabs button').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.login-tabs button')[tab==='login'?0:1].classList.add('active');
        document.getElementById('loginForm').style.display=tab==='login'?'block':'none';
        document.getElementById('signupForm').style.display=tab==='signup'?'block':'none';
        document.getElementById('loginError').style.display='none';
    }
    function showAuthError(msg){const e=document.getElementById('loginError');e.textContent=msg;e.style.display='block'}
    function clearAuthError(){document.getElementById('loginError').style.display='none'}

    async function doLogin(){
        clearAuthError();
        const email=document.getElementById('loginEmail').value.trim();
        const pass=document.getElementById('loginPass').value;
        if(!email||!pass)return showAuthError('Fill all fields');
        showLoading();
        try{
            if(!fbAuth){initFirebase();if(!fbAuth){showLoginPage();return showAuthError('Setup Firebase first (Friends page)')}}
            await fbAuth.signInWithEmailAndPassword(email,pass);
            showMainApp();
        }catch(e){showLoginPage();showAuthError(e.message.replace('Firebase: ','').replace(/\(auth\/.*\)\.?/,''))}
    }
    async function doSignup(){
        clearAuthError();
        const name=document.getElementById('signupName').value.trim();
        const email=document.getElementById('signupEmail').value.trim();
        const pass=document.getElementById('signupPass').value;
        if(!name||!email||!pass)return showAuthError('Fill all fields');
        if(pass.length<6)return showAuthError('Password must be 6+ characters');
        showLoading();
        try{
            if(!fbAuth){initFirebase();if(!fbAuth){showLoginPage();return showAuthError('Setup Firebase first (Friends page)')}}
            const cred=await fbAuth.createUserWithEmailAndPassword(email,pass);
            await cred.user.updateProfile({displayName:name});
            data.friends[1].name=name;
            currentUid=cred.user.uid;
            localStorage.setItem('friendsTracker',JSON.stringify(data));
            syncToFirebase();
            showMainApp();
        }catch(e){showLoginPage();showAuthError(e.message.replace('Firebase: ','').replace(/\(auth\/.*\)\.?/,''))}
    }
    async function doGoogleLogin(){
        clearAuthError();showLoading();
        try{
            if(!fbAuth){initFirebase();if(!fbAuth){showLoginPage();return showAuthError('Setup Firebase first (Friends page)')}}
            const provider=new firebase.auth.GoogleAuthProvider();
            const cred=await fbAuth.signInWithPopup(provider);
            if(cred.additionalUserInfo&&cred.additionalUserInfo.isNewUser){
                data.friends[1].name=cred.user.displayName||'User';
                currentUid=cred.user.uid;
                localStorage.setItem('friendsTracker',JSON.stringify(data));
                syncToFirebase();
            }
            showMainApp();
        }catch(e){showLoginPage();showAuthError(e.message.replace('Firebase: ','').replace(/\(auth\/.*\)\.?/,''))}
    }
    async function doResetPass(){
        const email=document.getElementById('loginEmail').value.trim();
        if(!email)return showAuthError('Enter your email first');
        try{if(fbAuth)await fbAuth.sendPasswordResetEmail(email);alert('Reset email sent!')}catch(e){showAuthError(e.message)}
    }
    function doLogout(){
        if(fbAuth)fbAuth.signOut();
        currentUid=null;
        localStorage.removeItem('friendsTracker');
        data=loadData();
        showLoginPage();
    }
    function toggleUserMenu(){
        const dd=document.getElementById('userDropdown');
        dd.classList.toggle('show');
        if(dd.classList.contains('show')){
            const user=fbAuth?fbAuth.currentUser:null;
            document.getElementById('udName').textContent=user?(user.displayName||'User'):'User';
            document.getElementById('udEmail').textContent=user?(user.email||''):'';
            const av=document.getElementById('userAvatar');
            const avatarData=data.friends[1].avatar;
            if(avatarData&&avatarData.startsWith('data:')){
                av.innerHTML='<img src="'+avatarData+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
            }else if(avatarData){
                av.innerHTML='<span>'+avatarData+'</span>';
            }else{
                av.textContent=user?(user.displayName||user.email||'?')[0].toUpperCase():'?';
            }
            setTimeout(()=>document.addEventListener('click',function h(e){if(!e.target.closest('.user-menu')){dd.classList.remove('show');document.removeEventListener('click',h)}}),10);
        }
    }

    // ===== AVATAR & PROFILE =====
    const presetAvatars=['ðŸ˜€','ðŸ˜Ž','ðŸ¤“','ðŸ˜‡','ðŸ¥³','ðŸ˜ˆ','ðŸ¦Š','ðŸ±','ðŸ¶','ðŸ¦','ðŸ¯','ðŸ¸','ðŸµ','ðŸ§','ðŸ¦„','ðŸ´','ðŸ°','ðŸ»','ðŸ¼','ðŸ¨','ðŸ¤–','ðŸ‘¾','ðŸ‘½','ðŸŽƒ','ðŸ’€','ðŸ‘»','ðŸ”¥','â­','ðŸ’Ž','ðŸŒ¸','ðŸŒ»','ðŸ„','ðŸŽ­','ðŸ‘‘','ðŸŽ“','ðŸ§™','ðŸ¦¸','ðŸ¦¹','ðŸ§›','ðŸ›¸','ðŸš€','ðŸŽ¯','ðŸ†','âš¡','â¤ï¸','ðŸ’›','ðŸ’š','ðŸ’™','ðŸ’œ','ðŸ§¡','ðŸ–¤','ðŸ¤','ðŸ¤Ž'];
    let selectedAvatar=null;
    let selectedPhoto=null;

    function openProfileModal(){
        selectedAvatar=data.friends[1].avatar||null;
        selectedPhoto=null;
        document.getElementById('profileName').value=data.friends[1].name||'You';
        // Render avatar grid
        const grid=document.getElementById('avatarGrid');
        grid.innerHTML=presetAvatars.map(a=>'<div onclick="pickAvatar(\''+a+'\')" style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:1.4rem;border-radius:8px;cursor:pointer;border:2px solid '+(selectedAvatar===a?'var(--primary)':'transparent')+';background:rgba(255,255,255,.05);transition:.2s">'+a+'</div>').join('');
        // Update preview
        updateAvatarPreview();
        openModal('profile');
    }
    function pickAvatar(emoji){
        selectedAvatar=emoji;
        selectedPhoto=null;
        document.getElementById('photoInput').value='';
        updateAvatarPreview();
        // Update grid border
        document.querySelectorAll('#avatarGrid > div').forEach(d=>{
            d.style.borderColor=d.textContent===emoji?'var(--primary)':'transparent';
        });
    }
    function handlePhotoUpload(e){
        const file=e.target.files[0];if(!file)return;
        if(file.size>500000){alert('Photo too large. Max 500KB.');return}
        const reader=new FileReader();
        reader.onload=function(ev){
            // Resize to 200x200
            const img=new Image();
            img.onload=function(){
                const canvas=document.createElement('canvas');
                canvas.width=200;canvas.height=200;
                const ctx=canvas.getContext('2d');
                const size=Math.min(img.width,img.height);
                const x=(img.width-size)/2,y=(img.height-size)/2;
                ctx.drawImage(img,x,y,size,size,0,0,200,200);
                selectedPhoto=canvas.toDataURL('image/jpeg',0.7);
                selectedAvatar=null;
                updateAvatarPreview();
                document.querySelectorAll('#avatarGrid > div').forEach(d=>d.style.borderColor='transparent');
            };
            img.src=ev.target.result;
        };
        reader.readAsDataURL(file);
    }
    function updateAvatarPreview(){
        const preview=document.getElementById('profileAvatarPreview');
        if(selectedPhoto){
            preview.innerHTML='<img src="'+selectedPhoto+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
        }else if(selectedAvatar){
            preview.innerHTML='<span>'+selectedAvatar+'</span>';
        }else{
            const av=data.friends[1].avatar;
            if(av&&av.startsWith('data:')){
                preview.innerHTML='<img src="'+av+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
            }else if(av){
                preview.innerHTML='<span>'+av+'</span>';
            }else{
                preview.textContent=data.friends[1].name?data.friends[1].name[0].toUpperCase():'?';
            }
        }
    }
    function saveProfile(){
        const name=document.getElementById('profileName').value.trim();
        if(!name)return alert('Enter your name');
        data.friends[1].name=name;
        if(selectedPhoto)data.friends[1].avatar=selectedPhoto;
        else if(selectedAvatar)data.friends[1].avatar=selectedAvatar;
        // Update Firebase Auth display name
        if(fbAuth&&fbAuth.currentUser){
            fbAuth.currentUser.updateProfile({displayName:name}).catch(()=>{});
        }
        localStorage.setItem('friendsTracker',JSON.stringify(data));
        syncToFirebase();
        renderFriendToggle();renderAll();
        closeModal('profile');
    }

    function renderNotifications(){
        const el=document.getElementById('notifList');
        const notifs=(data.notifications||[]).slice().reverse().slice(0,20);
        if(!notifs.length){el.innerHTML='<div class="empty"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>';return}
        const icons={target:'ðŸŽ¯',goal:'ðŸ…',activity:'ðŸ“‹',streak:'ðŸ”¥',badge:'ðŸ†'};
        el.innerHTML=notifs.map(n=>{
            const t=new Date(n.time);
            const timeStr=t.toLocaleDateString([],{month:'short',day:'numeric'})+' '+t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
            return'<div class="ai"><div class="aic" style="background:rgba(253,203,110,.2)">'+(icons[n.type]||'ðŸ””')+'</div><div class="ainf"><h4>'+esc(n.title)+'</h4><p>'+esc(n.message)+'</p><p style="font-size:.65rem;color:var(--muted)">'+timeStr+'</p></div></div>';
        }).join('');
    }
    function showNotif(title,msg){
        const t=document.createElement('div');t.className='toast';t.innerHTML='<span>ðŸ”” '+esc(title)+'</span><span style="font-size:.75rem;color:var(--muted)">'+esc(msg)+'</span>';
        document.body.appendChild(t);setTimeout(()=>t.remove(),6000);
        if('Notification' in window&&Notification.permission==='granted')new Notification(title,{body:msg});
    }

    function genCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let r='';for(let i=0;i<6;i++)r+=c.charAt(Math.floor(Math.random()*c.length));return r}
    function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
    function getAvatarHtml(friend,size){
        size=size||38;
        if(friend.avatar&&friend.avatar.startsWith('data:'))return'<img src="'+friend.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
        if(friend.avatar)return'<span>'+friend.avatar+'</span>';
        return friend.name?friend.name.substring(0,2).toUpperCase():'?';
    }
    function getWeekAgo(){return Date.now()-7*86400000}
    function calcPts(f){return f.activities.filter(a=>new Date(a.date).getTime()>getWeekAgo()).reduce((s,a)=>s+a.points,0)+f.sessions.filter(a=>new Date(a.date).getTime()>getWeekAgo()).reduce((s,a)=>s+a.points,0)}

    // Theme
    function toggleTheme(){
        const t=document.documentElement.getAttribute('data-theme');
        document.documentElement.setAttribute('data-theme',t==='light'?'dark':'light');
        document.getElementById('themeIcon').className=t==='light'?'fas fa-moon':'fas fa-sun';
        localStorage.setItem('theme',t==='light'?'dark':'light');
    }
    (function(){const t=localStorage.getItem('theme');if(t){document.documentElement.setAttribute('data-theme',t);if(t==='light')document.getElementById('themeIcon').className='fas fa-sun'}})();

    // Navigation
    function showPage(p){
        document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
        document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
        const el=document.getElementById(p);if(el)el.classList.add('active');
        document.querySelectorAll('nav button').forEach(b=>{if(b.getAttribute('onclick')&&b.getAttribute('onclick').includes("'"+p+"'"))b.classList.add('active')});
        currentPage=p;renderAll();
    }
    function switchFriend(id){currentFriend=parseInt(id);renderFriendToggle();renderAll()}
    function renderFriendToggle(){
        const c=document.getElementById('friendToggle');
        const ids=Object.keys(data.friends);
        const maxShow=5;
        const show=ids.slice(0,maxShow);
        const extra=ids.length-maxShow;
        let html=show.map(id=>{const f=data.friends[id];return'<button class="'+(parseInt(id)===currentFriend?'active':'')+'" onclick="switchFriend('+id+')" ondblclick="editFriendName('+id+')">'+f.name+'</button>'}).join('');
        if(extra>0)html+='<button onclick="showPage(\'friends\')" title="'+extra+' more friends">+'+extra+'</button>';
        c.innerHTML=html;
    }
    function editFriendName(id){const n=prompt('Enter name:',data.friends[id].name);if(n&&n.trim()){data.friends[id].name=n.trim();saveData(data);renderFriendToggle();renderAll()}}

    // Modal
    function openModal(t){document.getElementById(t+'Modal').classList.add('act');if(t==='notif')renderNotifications();if(t==='profile')openProfileModal()}
    function closeModal(t){document.getElementById(t+'Modal').classList.remove('act')}
    document.querySelectorAll('.mo').forEach(o=>{o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('act')})});

    // Undo system
    function pushUndo(type,undoData){undoStack.push({type,data:undoData,time:Date.now()});setTimeout(()=>{if(undoStack.length>0&&Date.now()-undoStack[0].time>8000)undoStack.shift()},8000)}
    function showUndo(msg,cb){
        const t=document.createElement('div');t.className='toast';t.innerHTML='<span>'+msg+'</span><span class="undo-btn" onclick="this.parentElement.remove()">Undo</span>';
        document.body.appendChild(t);
        t.querySelector('.undo-btn').onclick=()=>{cb();t.remove()};
        setTimeout(()=>t.remove(),8000);
    }

    // ===== ACTIVITIES =====
    function addActivity(){
        const type=document.getElementById('activityType').value,desc=document.getElementById('activityDesc').value,dur=parseInt(document.getElementById('activityDuration').value);
        if(!desc||!dur)return alert('Fill all fields');
        const a={id:Date.now(),type,description:desc,duration:dur,date:new Date().toISOString(),points:Math.floor(dur/5)*10};
        data.friends[currentFriend].activities.push(a);
        data.friends[currentFriend].lastActive=new Date().toISOString();
        updateStreak(currentFriend);addXP(10);saveData(data);
        document.getElementById('activityDesc').value='';document.getElementById('activityDuration').value='';
        closeModal('activity');playSound('start');renderAll();
        pushNotificationToFriends('activity','ðŸ“‹ Activity Logged',data.friends[1].name+' logged '+type+': '+desc+' ('+Math.round(dur/60*10)/10+'h)');
    }
    function deleteActivity(id){
        const a=data.friends[currentFriend].activities.find(x=>x.id===id);
        pushUndo('activity',{id,friend:currentFriend});
        data.friends[currentFriend].activities=data.friends[currentFriend].activities.filter(x=>x.id!==id);
        saveData(data);renderAll();
        showUndo('Activity deleted',()=>{data.friends[currentFriend].activities.push(a);saveData(data);renderAll()});
    }
    function searchActivities(q){
        const items=document.querySelectorAll('#activityList .ai');
        items.forEach(i=>{i.style.display=i.textContent.toLowerCase().includes(q.toLowerCase())?'flex':'none'});
    }

    // ===== TIMER =====
    function setSessionType(t,btn){currentSessionType=t;document.querySelectorAll('.styp button').forEach(b=>b.classList.remove('active'));btn.classList.add('active')}
    function startTimer(){if(isTimerRunning)return;isTimerRunning=true;timerInterval=setInterval(()=>{timerSeconds++;updateTimerDisplay();updateFocusDisplay()},1000);playSound('start')}
    function pauseTimer(){isTimerRunning=false;clearInterval(timerInterval)}
    function stopTimer(){
        if(timerSeconds===0)return;pauseTimer();
        data.friends[currentFriend].sessions.push({id:Date.now(),type:currentSessionType,duration:timerSeconds,date:new Date().toISOString(),points:Math.floor(timerSeconds/300)*25});
        data.friends[currentFriend].lastActive=new Date().toISOString();
        updateStreak(currentFriend);addXP(Math.floor(timerSeconds/60)*2);saveData(data);
        timerSeconds=0;updateTimerDisplay();playSound('done');
        if(pomodoroMode){pomodoroMode=false;alert('Pomodoro complete! Take a 5 min break.')}
        renderAll();
    }
    function updateTimerDisplay(){const h=Math.floor(timerSeconds/3600),m=Math.floor((timerSeconds%3600)/60),s=timerSeconds%60;document.getElementById('timerDisplay').textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
    function updateFocusDisplay(){const m=Math.floor(timerSeconds/60),s=timerSeconds%60;document.getElementById('focusTimer').textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
    function startPomodoro(){pomodoroMode=true;currentSessionType='study';timerSeconds=25*60;updateTimerDisplay();startTimer()}
    function quickTimer(m){currentSessionType='study';timerSeconds=m*60;updateTimerDisplay();startTimer();showPage('timer');document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));document.querySelectorAll('nav button').forEach(b=>{if(b.getAttribute('onclick')&&b.getAttribute('onclick').includes("'timer'"))b.classList.add('active')})}
    function enterFocusMode(){focusActive=true;document.getElementById('focusOverlay').classList.add('active');document.getElementById('focusType').textContent=currentSessionType.charAt(0).toUpperCase()+currentSessionType.slice(1)+' Session'}
    function exitFocusMode(){focusActive=false;document.getElementById('focusOverlay').classList.remove('active')}

    // ===== GOALS =====
    function addGoal(){
        const title=document.getElementById('goalTitle').value,emoji=document.getElementById('goalEmoji').value||'ðŸŽ¯',target=parseInt(document.getElementById('goalTarget').value),unit=document.getElementById('goalUnit').value;
        if(!title||!target)return alert('Fill all fields');
        data.friends[currentFriend].goals.push({id:Date.now(),title,emoji,target,unit,current:0});
        saveData(data);document.getElementById('goalTitle').value='';document.getElementById('goalTarget').value='';closeModal('goal');renderAll();
        pushNotificationToFriends('goal','ðŸŽ¯ New Goal',data.friends[1].name+' set a goal: '+emoji+' '+title+' ('+target+' '+unit+')');
    }
    function deleteGoal(id){pushUndo('goal',{id,friend:currentFriend,data:{...data.friends[currentFriend].goals.find(g=>g.id===id)}});data.friends[currentFriend].goals=data.friends[currentFriend].goals.filter(g=>g.id!==id);saveData(data);renderAll();showUndo('Goal deleted',()=>{data.friends[currentFriend].goals.push(undoStack.pop().data.data);saveData(data);renderAll()})}
    function updateGoalProgress(id,d){const g=data.friends[currentFriend].goals.find(x=>x.id===id);if(g){g.current=Math.max(0,Math.min(g.target,g.current+d));if(g.current>=g.target)addXP(50);saveData(data);renderAll()}}

    // ===== STREAK =====
    function updateStreak(fn){
        const f=data.friends[fn],today=new Date().toDateString(),la=f.lastActive?new Date(f.lastActive).toDateString():null;
        if(la!==today){const y=new Date(Date.now()-86400000).toDateString();if(la===y)f.streak++;else if(la!==today)f.streak=1}
    }

    // ===== XP & LEVELS =====
    const levels=[{name:'Beginner',req:0},{name:'Learner',req:100},{name:'Student',req:300},{name:'Scholar',req:600},{name:'Expert',req:1000},{name:'Master',req:1500},{name:'Guru',req:2500},{name:'Legend',req:4000},{name:'Champion',req:6000},{name:'Titan',req:10000}];
    function addXP(pts){
        const f=data.friends[currentFriend];f.xp=(f.xp||0)+pts;
        let leveled=false;
        while(f.level<levels.length && f.xp>=levels[f.level].req){f.level++;leveled=true}
        if(leveled){playSound('levelup');setTimeout(()=>alert('Level Up! You are now Level '+f.level+' - '+levels[f.level-1].name+'!'),50)}
        saveData(data);
    }
    function renderXP(){
        const f=data.friends[currentFriend],lvl=f.level||1,xp=f.xp||0;
        const cur=levels[lvl-1]?levels[lvl-1].req:0,nxt=levels[lvl]?levels[lvl].req:cur+500;
        const pct=Math.min(100,((xp-cur)/(nxt-cur))*100);
        document.getElementById('levelBadge').textContent=lvl;
        document.getElementById('levelText').textContent='Level '+lvl+' - '+(levels[lvl-1]?levels[lvl-1].name:'Legend');
        document.getElementById('xpText').textContent=xp+' / '+nxt+' XP';
        document.getElementById('xpBar').style.width=pct+'%';
    }

    // ===== BADGES =====
    const allBadges=[
        {id:'first_activity',icon:'ðŸŒŸ',name:'First Step',desc:'Log your first activity'},
        {id:'streak_3',icon:'ðŸ”¥',name:'On Fire',desc:'3 day streak'},
        {id:'streak_7',icon:'ðŸŒ‹',name:'Unstoppable',desc:'7 day streak'},
        {id:'streak_30',icon:'ðŸ’Ž',name:'Diamond',desc:'30 day streak'},
        {id:'hours_10',icon:'â°',name:'Time Keeper',desc:'10 hours studied'},
        {id:'hours_50',icon:'ðŸ“š',name:'Bookworm',desc:'50 hours studied'},
        {id:'hours_100',icon:'ðŸ†',name:'Century',desc:'100 hours studied'},
        {id:'goals_5',icon:'ðŸŽ¯',name:'Goal Crusher',desc:'Complete 5 goals'},
        {id:'sessions_20',icon:'â±ï¸',name:'Dedicated',desc:'20 timer sessions'},
        {id:'chat_10',icon:'ðŸ’¬',name:'Social Butterfly',desc:'Send 10 messages'},
    ];
    function checkBadges(){
        const f=data.friends[currentFriend];
        if(!f.badges)f.badges=[];
        const add=(id)=>{if(!f.badges.includes(id)){f.badges.push(id);playSound('levelup');saveData(data)}};
        if(f.activities.length>=1)add('first_activity');
        if(f.streak>=3)add('streak_3');
        if(f.streak>=7)add('streak_7');
        if(f.streak>=30)add('streak_30');
        const totalH=f.activities.reduce((s,a)=>s+a.duration,0)/3600+f.sessions.reduce((s,a)=>s+a.duration,0)/3600;
        if(totalH>=10)add('hours_10');if(totalH>=50)add('hours_50');if(totalH>=100)add('hours_100');
        if(f.goals.filter(g=>g.current>=g.target).length>=5)add('goals_5');
        if(f.sessions.length>=20)add('sessions_20');
        if((data.messages||[]).filter(m=>m.senderId===currentFriend).length>=10)add('chat_10');
    }
    function renderBadges(){
        const f=data.friends[currentFriend],grid=document.getElementById('badgesGrid');
        grid.innerHTML=allBadges.map(b=>'<div class="badge-card '+(f.badges&&f.badges.includes(b.id)?'':'locked')+'"><div class="badge-icon">'+b.icon+'</div><h4>'+b.name+'</h4><p>'+b.desc+'</p></div>').join('');
    }

    // ===== DAILY CHALLENGES =====
    function renderDailyChallenges(){
        const f=data.friends[currentFriend],today=new Date().toDateString();
        const challenges=[
            {id:'dc1',name:'Study 2 Hours',target:120,current:f.activities.filter(a=>new Date(a.date).toDateString()===today).reduce((s,a)=>s+a.duration,0),unit:'min',xp:30},
            {id:'dc2',name:'Complete 3 Tasks',target:3,current:f.activities.filter(a=>new Date(a.date).toDateString()===today).length,unit:'tasks',xp:20},
            {id:'dc3',name:'1 Timer Session',target:1,current:f.sessions.filter(s=>new Date(s.date).toDateString()===today).length,unit:'sessions',xp:15},
        ];
        document.getElementById('dailyChallenges').innerHTML=challenges.map(c=>{
            const pct=Math.min(100,(c.current/c.target)*100);
            const done=c.current>=c.target;
            return'<div class="ai" style="opacity:'+(done?'.5':'1')+'"><div class="aic" style="background:'+(done?'rgba(0,184,148,.2)':'rgba(253,203,110,.2)')+'">'+(done?'âœ…':'âš¡')+'</div><div class="ainf"><h4>'+c.name+'</h4><div class="pb" style="margin-top:4px"><div class="pf" style="width:'+pct+'%"></div></div><p>'+Math.min(c.current,c.target)+' / '+c.target+' '+c.unit+' â€¢ +'+c.xp+' XP</p></div></div>';
        }).join('');
    }

    // ===== CHALLENGES =====
    function createChallenge(){
        const type=document.getElementById('challengeType').value,dur=parseInt(document.getElementById('challengeDuration').value);
        const f2=Object.keys(data.friends).find(id=>parseInt(id)!==currentFriend);
        if(!f2)return alert('Add a friend first!');
        data.challenges.push({id:Date.now(),type,duration:dur,friend1:currentFriend,friend2:parseInt(f2),startDate:new Date().toISOString(),status:'active'});
        saveData(data);closeModal('challenge');renderChallenges();
    }
    function renderChallenges(){
        const el=document.getElementById('challengesList');
        const active=(data.challenges||[]).filter(c=>c.status==='active');
        if(!active.length){el.innerHTML='<div class="empty"><i class="fas fa-trophy"></i><p>No active challenges. Start one!</p></div>';return}
        el.innerHTML=active.map(c=>{
            const f1=data.friends[c.friend1],f2=data.friends[c.friend2];
            const p1=calcPts(f1),p2=calcPts(f2);
            return'<div class="challenge-card"><h3>ðŸ† '+c.type.charAt(0).toUpperCase()+c.type.slice(1)+' Challenge</h3><p>'+f1.name+' vs '+f2.name+' â€¢ '+c.duration+' days</p><div class="challenge-prog"><span>'+f1.name+': '+p1+'</span><div class="bar"><div class="fill" style="width:'+Math.min(100,p1/(p1+p2||1)*100)+'%"></div></div><span>'+p2+': '+f2.name+'</span></div></div>';
        }).join('');
    }

    // ===== CHAT =====
    function sendMessage(){
        const input=document.getElementById('chatInput'),text=input.value.trim();if(!text)return;
        const me=data.friends[currentFriend];
        if(!data.messages)data.messages=[];
        data.messages.push({id:Date.now(),sender:me.name,senderId:currentFriend,text,time:new Date().toISOString(),reactions:[]});
        saveData(data);input.value='';checkBadges();renderChat();
    }
    function sendQuickReply(t){document.getElementById('chatInput').value=t;sendMessage()}
    function addReaction(msgId,emoji){
        const msg=data.messages.find(m=>m.id===msgId);
        if(msg){if(!msg.reactions)msg.reactions=[];const existing=msg.reactions.find(r=>r.emoji===emoji&&r.userId===currentFriend);
        if(existing)msg.reactions=msg.reactions.filter(r=>!(r.emoji===emoji&&r.userId===currentFriend));
        else msg.reactions.push({emoji,userId:currentFriend});saveData(data);renderChat()}
    }
    function renderChat(){
        const c=document.getElementById('chatMessages');
        if(!data.messages||!data.messages.length){c.innerHTML='<div class="empty"><i class="fas fa-comments"></i><p>Start chatting!</p></div>';return}
        const reacts=['ðŸ‘','â¤ï¸','ðŸ˜‚','ðŸ”¥','ðŸ’¯'];
        c.innerHTML=data.messages.map(m=>{
            const isMine=m.senderId===currentFriend;
            const time=new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
            const rHtml=m.reactions&&m.reactions.length?'<div class="cm-reactions">'+m.reactions.map(r=>'<button onclick="addReaction('+m.id+',\''+r.emoji+'\')">'+r.emoji+' '+m.reactions.filter(x=>x.emoji===r.emoji).length+'</button>').join('')+'</div>':'';
            const reactBtns='<div class="cm-reactions" style="margin-top:4px">'+reacts.map(r=>'<button onclick="addReaction('+m.id+',\''+r+'\')" style="font-size:.6rem;padding:1px 4px">'+r+'</button>').join('')+'</div>';
            // Get sender avatar
            let senderAv='ðŸ‘¤';
            const senderFriend=Object.values(data.friends).find(f=>f.name===m.sender);
            if(senderFriend&&senderFriend.avatar){
                if(senderFriend.avatar.startsWith('data:'))senderAv='<img src="'+senderFriend.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
                else senderAv=senderFriend.avatar;
            }
            const avHtml=isMine?'':'<div style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0">'+senderAv+'</div>';
            return'<div class="cm '+(isMine?'sent':'rcv')+'" style="display:flex;gap:6px;align-items:flex-end">'+avHtml+'<div>'+(!isMine?'<span class="ms">'+m.sender+'</span>':'')+'<div>'+esc(m.text)+'</div><span class="mt">'+time+'</span>'+rHtml+reactBtns+'</div></div>';
        }).join('');
        c.scrollTop=c.scrollHeight;
    }

    // ===== MOOD =====
    function setMood(e,l){if(!data.moods)data.moods={};data.moods[currentFriend]={emoji:e,label:l,date:new Date().toISOString()};saveData(data);renderMood()}
    function renderMood(){if(!data.moods||!data.moods[currentFriend])return;const m=data.moods[currentFriend];if(new Date(m.date).toDateString()===new Date().toDateString())document.getElementById('currentMood').innerHTML='<span style="font-size:1.8rem">'+m.emoji+'</span> '+m.label}

    // ===== REMINDERS =====
    function addReminder(){
        const title=document.getElementById('reminderTitle').value,time=document.getElementById('reminderTime').value,repeat=document.getElementById('reminderRepeat').value;
        if(!title||!time)return alert('Fill all fields');
        if(!data.reminders)data.reminders=[];
        data.reminders.push({id:Date.now(),title,time,repeat,enabled:true,createdAt:new Date().toISOString()});
        saveData(data);document.getElementById('reminderTitle').value='';closeModal('reminder');renderReminders();scheduleReminders();requestNotificationPermission();
    }
    function toggleReminder(id){const r=data.reminders.find(x=>x.id===id);if(r){r.enabled=!r.enabled;saveData(data);renderReminders();scheduleReminders()}}
    function deleteReminder(id){data.reminders=data.reminders.filter(r=>r.id!==id);saveData(data);renderReminders()}
    function renderReminders(){
        const el=document.getElementById('remindersList');
        if(!data.reminders||!data.reminders.length){el.innerHTML='<div class="empty"><i class="fas fa-bell-slash"></i><p>No reminders yet</p></div>';return}
        const rl={daily:'Every Day',weekdays:'Weekdays',weekends:'Weekends',once:'Once'};
        el.innerHTML=data.reminders.map(r=>'<div class="rcard" style="opacity:'+(r.enabled?1:.5)+'"><div class="ri" style="background:rgba(253,203,110,.2)">ðŸ””</div><div class="rinf"><h4>'+esc(r.title)+'</h4><p>'+r.time+' â€¢ '+rl[r.repeat]+'</p></div><label class="tgl"><input type="checkbox" '+(r.enabled?'checked':'')+' onchange="toggleReminder('+r.id+')"><span class="sl"></span></label><button class="adel" onclick="deleteReminder('+r.id+')"><i class="fas fa-trash"></i></button></div>').join('');
    }
    function scheduleReminders(){if(!data.reminders)return;data.reminders.forEach(r=>{if(!r.enabled)return;const[h,m]=r.time.split(':').map(Number);const now=new Date(),tgt=new Date();tgt.setHours(h,m,0,0);if(tgt<=now)tgt.setDate(tgt.getDate()+1);setTimeout(()=>{if(r.enabled){showNotif(r.title,r.time);if(r.repeat==='once'){r.enabled=false;saveData(data);renderReminders()}}},tgt-now)})}
    function showNotif(title,time){
        if('Notification' in window&&Notification.permission==='granted')new Notification('StudyBuddy',{body:title+' at '+time});
        const t=document.createElement('div');t.className='toast';t.innerHTML='<span>ðŸ”” '+esc(title)+' - '+time+'</span>';document.body.appendChild(t);setTimeout(()=>t.remove(),5000);
    }
    function requestNotificationPermission(){if('Notification' in window&&Notification.permission==='default')Notification.requestPermission()}

    // ===== SCHEDULE =====
    function addSchedule(){
        const time=document.getElementById('schedTime').value,act=document.getElementById('schedActivity').value;
        if(!time||!act)return alert('Fill all fields');
        if(!data.schedule)data.schedule=[];
        data.schedule.push({id:Date.now(),time,activity:act});saveData(data);closeModal('schedule');renderSchedule();
    }
    function deleteSchedule(id){data.schedule=data.schedule.filter(s=>s.id!==id);saveData(data);renderSchedule()}
    function renderSchedule(){
        const el=document.getElementById('scheduleList');
        if(!data.schedule||!data.schedule.length){el.innerHTML='<div class="empty"><i class="fas fa-calendar"></i><p>No schedule yet</p></div>';return}
        el.innerHTML=data.schedule.sort((a,b)=>a.time.localeCompare(b.time)).map(s=>'<div class="sched-slot"><span class="stime">'+s.time+'</span><span class="stxt">'+esc(s.activity)+'</span><button class="sdel" onclick="deleteSchedule('+s.id+')"><i class="fas fa-times"></i></button></div>').join('');
    }

    // ===== DAILY TARGET =====
    function setDailyTarget(){const h=parseInt(document.getElementById('targetHours').value);if(!h||h<1)return;data.dailyTarget=h;saveData(data);closeModal('target');renderDailyTarget();pushNotificationToFriends('target','ðŸŽ¯ Daily Target Set',data.friends[1].name+' set a target of '+h+' hours/day')}
    function renderDailyTarget(){
        const f=data.friends[currentFriend],today=new Date().toDateString();
        const mins=f.activities.filter(a=>new Date(a.date).toDateString()===today).reduce((s,a)=>s+a.duration,0)+f.sessions.filter(s=>new Date(s.date).toDateString()===today).reduce((s,a)=>s+a.duration/60,0);
        const hrs=mins/60,target=data.dailyTarget||4,pct=Math.min(100,(hrs/target)*100);
        document.getElementById('dailyTargetBar').style.width=pct+'%';
        document.getElementById('dailyTargetText').textContent=hrs.toFixed(1)+' / '+target+'h';
    }

    // ===== ANALYTICS =====
    function renderAnalytics(){
        const f=data.friends[currentFriend];
        // Productivity score
        const days=7,active=f.activities.filter(a=>new Date(a.date).getTime()>getWeekAgo()).length+f.sessions.filter(s=>new Date(s.date).getTime()>getWeekAgo()).length;
        const prod=Math.min(100,Math.round((active/(days*2))*100));
        document.getElementById('prodScore').textContent=prod+'%';
        // Best time
        const hours={};
        f.activities.forEach(a=>{const h=new Date(a.date).getHours();hours[h]=(hours[h]||0)+a.duration});
        const best=Object.entries(hours).sort((a,b)=>b[1]-a[1])[0];
        document.getElementById('bestTime').textContent=best?String(best[0]).padStart(2,'0')+':00':'--';
        // Active days
        const actDays=new Set([...f.activities,...f.sessions].map(a=>new Date(a.date).toDateString()));
        document.getElementById('totalDays').textContent=actDays.size;
        // Avg daily
        const totalH=(f.activities.reduce((s,a)=>s+a.duration,0)+f.sessions.reduce((s,a)=>s+a.duration,0)/60)/60;
        document.getElementById('avgDaily').textContent=(totalH/7).toFixed(1)+'h';
        // Subject breakdown
        const subjects={};
        f.activities.forEach(a=>{subjects[a.type]=(subjects[a.type]||0)+a.duration});
        f.sessions.forEach(s=>{subjects[s.type]=(subjects[s.type]||0)+s.duration/60*60});
        const total=Object.values(subjects).reduce((s,v)=>s+v,0)||1;
        const icons={study:'ðŸ“š',reading:'ðŸ“–',coding:'ðŸ’»',exercise:'ðŸƒ',work:'ðŸ’¼',break:'â˜•',other:'ðŸ“‹'};
        const colors={study:'var(--primary)',reading:'var(--secondary)',coding:'var(--accent)',exercise:'var(--success)',work:'var(--warning)',break:'#81ecec',other:'var(--muted)'};
        document.getElementById('subjectChart').innerHTML=Object.entries(subjects).sort((a,b)=>b[1]-a[1]).map(([t,v])=>{
            const pct=(v/total*100).toFixed(0);
            return'<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="font-size:1.2rem;width:28px">'+(icons[t]||'ðŸ“‹')+'</span><div style="flex:1"><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:2px"><span>'+t.charAt(0).toUpperCase()+t.slice(1)+'</span><span>'+pct+'%</span></div><div class="pb"><div class="pf" style="width:'+pct+'%;background:'+colors[t]+'"></div></div></div></div>';
        }).join('')||'<div class="empty"><p>No data yet</p></div>';
        // Leaderboard history
        const hist= document.getElementById('leaderHistory');
        const weeks=['This Week','Last Week','2 Weeks Ago'];
        hist.innerHTML=weeks.map((w,i)=>{
            const wkPts=calcPts(f)-Math.floor(Math.random()*50*i);
            return'<div class="ai"><div class="aic" style="background:rgba(253,203,110,.2)">'+['ðŸ¥‡','ðŸ¥ˆ','ðŸ¥‰'][i]+'</div><div class="ainf"><h4>'+w+'</h4><p>'+wkPts+' points</p></div></div>';
        }).join('');
        // Leaderboard
        const ids=Object.keys(data.friends);
        if(ids.length>=2){
            const sorted=ids.map(id=>({id,pts:calcPts(data.friends[id]),name:data.friends[id].name})).sort((a,b)=>b.pts-a.pts);
            document.getElementById('leaderboard').innerHTML=sorted.map((p,i)=>'<div class="lb-item '+(i===0?'win':'')+'"><div class="rk '+(i===0?'g':'s')+'">'+(i+1)+'</div><div class="av" style="background:linear-gradient(135deg,'+(i===0?'var(--primary),var(--primary-light)':'var(--secondary),#55efc4')+')">'+p.name.substring(0,2).toUpperCase()+'</div><div class="lbi"><h3>'+p.name+'</h3><p>'+p.pts+' points</p></div><div class="lbs">'+p.pts+' pts</div></div>').join('');
        }
        // Achievements
        const achList=document.getElementById('achievementsList');
        const ach=[];
        if(f.streak>=3)ach.push({icon:'ðŸ”¥',title:'Hot Streak',desc:'3+ day streak'});
        if(f.sessions.length>=10)ach.push({icon:'â±ï¸',title:'Time Master',desc:'10+ sessions'});
        if(calcPts(f)>=100)ach.push({icon:'ðŸ†',title:'Century Club',desc:'100+ points'});
        if(f.goals.some(g=>g.current>=g.target))ach.push({icon:'ðŸŽ¯',title:'Goal Crusher',desc:'Completed a goal'});
        achList.innerHTML=ach.length?ach.map(a=>'<div class="ai"><div class="aic" style="background:rgba(253,203,110,.2)">'+a.icon+'</div><div class="ainf"><h4>'+a.title+'</h4><p>'+a.desc+'</p></div></div>').join(''):'<div class="empty"><p>Keep going!</p></div>';
    }

    // ===== CALENDAR =====
    function renderCalendar(){
        const grid=document.getElementById('calendarGrid');
        const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
        document.getElementById('calMonth').textContent=months[calMonth]+' '+calYear;
        const firstDay=new Date(calYear,calMonth,1).getDay();
        const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
        const f=data.friends[currentFriend];
        const days={};
        f.activities.forEach(a=>{const d=new Date(a.date);if(d.getMonth()===calMonth&&d.getFullYear()===calYear){const day=d.getDate();days[day]=(days[day]||0)+a.duration}});
        f.sessions.forEach(s=>{const d=new Date(s.date);if(d.getMonth()===calMonth&&d.getFullYear()===calYear){const day=d.getDate();days[day]=(days[day]||0)+s.duration/60}});
        const maxMin=Math.max(...Object.values(days),1);
        let html=['S','M','T','W','T','F','S'].map(d=>'<div class="cal-hdr">'+d+'</div>').join('');
        for(let i=0;i<firstDay;i++)html+='<div class="cal-day empty"></div>';
        const today=new Date();
        for(let d=1;d<=daysInMonth;d++){
            const mins=days[d]||0;
            const lvl=mins===0?0:mins<30?1:mins<60?2:mins<120?3:4;
            const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
            html+='<div class="cal-day l'+lvl+(isToday?' today':'')+'" title="'+mins+' min">'+d+'</div>';
        }
        grid.innerHTML=html;
    }
    function changeMonth(d){calMonth+=d;if(calMonth>11){calMonth=0;calYear++}if(calMonth<0){calMonth=11;calYear--}renderCalendar()}

    // ===== WEEK DOTS =====
    function renderWeekDots(){
        const dots=document.getElementById('weekDots'),names=['S','M','T','W','T','F','S'],today=new Date().getDay(),f=data.friends[currentFriend],la=f.lastActive?new Date(f.lastActive):null;
        dots.innerHTML=names.map((n,i)=>{let c='wd';if(i===today)c+=' today';if(la&&la.getDay()===i)c+=' act';return'<div class="'+c+'">'+n+'</div>'}).join('');
    }

    // ===== DAILY SUMMARY =====
    function renderDailySummary(){
        const el=document.getElementById('dailySummary');if(!el)return;
        const f=data.friends[currentFriend],today=new Date().toDateString();
        const ta=f.activities.filter(a=>new Date(a.date).toDateString()===today),ts=f.sessions.filter(s=>new Date(s.date).toDateString()===today);
        const totalMin=ta.reduce((s,a)=>s+a.duration,0)+ts.reduce((s,a)=>s+a.duration/60,0);
        const icons={study:'ðŸ“š',reading:'ðŸ“–',coding:'ðŸ’»',exercise:'ðŸƒ',work:'ðŸ’¼',break:'â˜•',other:'ðŸ“‹'};
        let html='<div style="margin-bottom:10px"><strong>Total: </strong>'+(totalMin/60).toFixed(1)+' hours</div>';
        const st={};ta.forEach(a=>{st[a.type]=(st[a.type]||0)+a.duration});ts.forEach(s=>{st[s.type]=(st[s.type]||0)+s.duration/60});
        if(Object.keys(st).length)html+=Object.entries(st).map(([t,m])=>{const p=totalMin>0?(m/totalMin*100).toFixed(0):0;return'<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:.8rem"><span>'+(icons[t]||'ðŸ“‹')+' '+t+'</span><span>'+(m/60).toFixed(1)+'h ('+p+'%)</span></div><div class="pb" style="margin-top:3px"><div class="pf" style="width:'+p+'%"></div></div></div>'}).join('');
        else html+='<p style="color:var(--muted);font-size:.8rem">No activities yet today</p>';
        el.innerHTML=html;
    }

    // ===== EXPORT =====
    function exportPDF(){
        const f=data.friends[currentFriend];
        let c='WEEKLY ACTIVITY REPORT\n========================\n\nName: '+f.name+'\nDate: '+new Date().toLocaleDateString()+'\nStreak: '+f.streak+' days\nLevel: '+(f.level||1)+'\nXP: '+(f.xp||0)+'\n\n--- ACTIVITIES ---\n';
        f.activities.forEach(a=>{c+=new Date(a.date).toLocaleDateString()+' | '+a.type+' | '+a.description+' | '+Math.round(a.duration/60)+'m\n'});
        c+='\n--- SESSIONS ---\n';f.sessions.forEach(s=>{const h=Math.floor(s.duration/3600),m=Math.floor((s.duration%3600)/60);c+=new Date(s.date).toLocaleDateString()+' | '+s.type+' | '+(h?h+'h ':'')+m+'m\n'});
        if(f.goals.length){c+='\n--- GOALS ---\n';f.goals.forEach(g=>{c+=g.emoji+' '+g.title+' | '+g.current+'/'+g.target+' '+g.unit+' ('+(g.current/g.target*100).toFixed(0)+'%)\n'})}
        download(c,'report-'+f.name+'.txt','text/plain');alert('Report downloaded!');
    }
    function exportJSON(){download(JSON.stringify(data.friends[currentFriend],null,2),'data-'+data.friends[currentFriend].name+'.json','application/json')}
    function exportCSV(){
        let csv='Date,Type,Description,Duration(min),Points\n';
        const f=data.friends[currentFriend];f.activities.forEach(a=>{csv+=new Date(a.date).toLocaleDateString()+','+a.type+',"'+a.description.replace(/"/g,'""')+'",'+Math.round(a.duration/60)+','+a.points+'\n'});
        f.sessions.forEach(s=>{csv+=new Date(s.date).toLocaleDateString()+','+s.type+',Timer,'+Math.round(s.duration/60)+','+s.points+'\n'});
        download(csv,'data-'+f.name+'.csv','text/csv');
    }
    function download(c,f,t){const b=new Blob([c],{type:t}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=f;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u)}

    // Safe DOM helper
    function $(id){return document.getElementById(id)}
    function setH(id,v){const e=$(id);if(e)e.textContent=v}
    function setI(id,v){const e=$(id);if(e)e.innerHTML=v}
    function setW(id,v){const e=$(id);if(e)e.style.width=v}

    // ===== RENDER ALL =====
    function renderAll(){
        try{_renderAll()}catch(e){console.error('Render error:',e)}
    }
    function _renderAll(){
        const f=data.friends[currentFriend];if(!f)return;
        const today=new Date().toDateString(),ta=f.activities.filter(a=>new Date(a.date).toDateString()===today),ts=f.sessions.filter(s=>new Date(s.date).toDateString()===today);
        const totalMin=ta.reduce((s,a)=>s+a.duration,0)+ts.reduce((s,a)=>s+a.duration/60,0);
        const icons={study:'ðŸ“š',reading:'ðŸ“–',coding:'ðŸ’»',exercise:'ðŸƒ',work:'ðŸ’¼',break:'â˜•',other:'ðŸ“‹'};
        const bgC={study:'rgba(108,92,231,.2)',reading:'rgba(0,206,201,.2)',coding:'rgba(253,121,168,.2)',exercise:'rgba(0,184,148,.2)',work:'rgba(253,203,110,.2)',break:'rgba(129,236,236,.2)',other:'rgba(136,136,170,.2)'};

        // Dashboard stats
        setH('totalStudy',(totalMin/60).toFixed(1)+'h');
        setH('tasksDone',ta.length+ts.length);
        setH('curStreak',f.streak);
        setH('weekPts',calcPts(f));

        // Activity list
        const all=[...f.activities,...f.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,10);
        setI('activityList',all.length?all.map(a=>{const d=a.duration>=3600?(a.duration/3600).toFixed(1)+'h':Math.round(a.duration/60)+'m';return'<div class="ai"><div class="aic" style="background:'+(bgC[a.type]||bgC.other)+'">'+(icons[a.type]||'ðŸ“‹')+'</div><div class="ainf"><h4>'+esc(a.description)+'</h4><p>'+a.type+' â€¢ '+new Date(a.date).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</p></div><span class="at">'+d+'</span><button class="adel" onclick="deleteActivity('+a.id+')"><i class="fas fa-trash"></i></button></div>'}).join(''):'<div class="empty"><i class="fas fa-clipboard-list"></i><p>No activities yet</p></div>');

        // Weekly chart
        const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],wa=getWeekAgo();
        const mins=days.map((_,i)=>{const ds=wa+i*86400000,de=ds+86400000;return f.activities.filter(a=>{const t=new Date(a.date).getTime();return t>=ds&&t<de}).reduce((s,a)=>s+a.duration,0)/60});
        const mx=Math.max(...mins,1);
        setI('weeklyChart',days.map((d,i)=>'<div class="bw"><div class="bv">'+mins[i].toFixed(0)+'m</div><div class="bar p" style="height:'+Math.max((mins[i]/mx)*180,4)+'px"></div><div class="bl">'+d+'</div></div>').join(''));

        // Timer page
        setH('todayTotal',Math.floor(totalMin/60)+'h '+Math.round(totalMin%60)+'m');
        setI('sessionLog',ts.length?ts.slice().reverse().map(s=>{const h=Math.floor(s.duration/3600),m=Math.floor((s.duration%3600)/60);return'<div class="se"><span>'+(icons[s.type]||'ðŸ“‹')+' '+s.type+'</span><span class="dur">'+(h?h+'h ':'')+m+'m</span><span class="tm">'+new Date(s.date).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'</span></div>'}).join(''):'<div class="empty"><p>Start a timer!</p></div>');

        // Goals
        setI('goalsGrid',f.goals.length?f.goals.map(g=>{const p=(g.current/g.target*100).toFixed(0);return'<div class="gc"><div class="gh"><span class="ge">'+g.emoji+'</span><button class="gdel" onclick="deleteGoal('+g.id+')"><i class="fas fa-trash"></i></button></div><h3>'+g.title+'</h3><div class="pb"><div class="pf" style="width:'+p+'%"></div></div><div class="pt"><span>'+g.current+'/'+g.target+' '+g.unit+'</span><span>'+p+'%</span></div><div style="display:flex;gap:6px;margin-top:10px"><button class="btn bs bsm" onclick="updateGoalProgress('+g.id+',-1)">-1</button><button class="btn bgs bsm" onclick="updateGoalProgress('+g.id+',1)">+1</button></div></div>'}).join(''):'<div class="empty" style="grid-column:1/-1"><i class="fas fa-bullseye"></i><p>No goals yet</p></div>');
        setH('streakBig',f.streak);

        // My code
        if(f.myCode)setH('myCode',f.myCode);

        // Sub-pages
        renderChat();renderMood();renderReminders();renderSchedule();renderDailySummary();renderDailyTarget();renderAnalytics();renderCalendar();renderWeekDots();renderXP();renderBadges();renderDailyChallenges();renderChallenges();renderFriendList();
        // New features
        renderAchievements();renderLeaderboard();renderNotes();renderPomodoro();renderAgenda();newQuote();
        // Notification badge
        const notifCount=(data.notifications||[]).length;
        const badge=document.getElementById('notifBadge');
        if(badge){badge.style.display=notifCount>0?'flex':'none';badge.textContent=notifCount;badge.style.alignItems='center';badge.style.justifyContent='center'}
    }

    function renderFriendList(){
        const el=document.getElementById('friendsList'),ids=Object.keys(data.friends);
        const colors=['#6c5ce7','#00cec9','#fd79a8','#00b894','#fdcb6e','#e17055'];
        let html='<div style="font-size:.8rem;color:var(--muted);margin-bottom:10px">'+ids.length+' friend'+(ids.length!==1?'s':'')+'</div>';
        html+=ids.map((id,i)=>{const f=data.friends[id],c=colors[i%colors.length],isActive=parseInt(id)===currentFriend,total=f.activities.length+f.sessions.length,isMe=parseInt(id)===1;
            let avHtml='';
            if(f.avatar&&f.avatar.startsWith('data:')){
                avHtml='<img src="'+f.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
            }else if(f.avatar){
                avHtml=f.avatar;
            }else{
                avHtml=f.name.substring(0,2).toUpperCase();
            }
            return'<div class="ai" style="'+(isActive?'border:1px solid '+c+'40;background:'+c+'10':'')+'"><div class="av" style="background:'+c+';width:38px;height:38px;font-size:.8rem">'+avHtml+'</div><div class="ainf"><h4>'+f.name+(isMe?' (You)':'')+'</h4><p>'+total+' activities â€¢ '+f.streak+' streak â€¢ Lv.'+(f.level||1)+'</p>'+(f.code?'<p style="font-size:.65rem;color:var(--primary-light);font-family:monospace">'+f.code+'</p>':'')+'</div><div style="display:flex;gap:4px">'+(!isMe?'<button class="btn bgs bsm" onclick="viewFriendProfile('+id+')"><i class="fas fa-eye"></i> View</button>':'')+(!isMe?'<button class="adel" onclick="removeFriend('+id+')"><i class="fas fa-trash"></i></button>':'')+'</div></div>';
        }).join('');
        el.innerHTML=html;
    }

    // Friend profile view
    let viewingFriendId=null;
    function viewFriendProfile(id){
        viewingFriendId=parseInt(id);
        const f=data.friends[id];if(!f)return;
        const icons={study:'ðŸ“š',reading:'ðŸ“–',coding:'ðŸ’»',exercise:'ðŸƒ',work:'ðŸ’¼',break:'â˜•',other:'ðŸ“‹'};
        const totalMin=f.activities.reduce((s,a)=>s+a.duration,0)+f.sessions.reduce((s,a)=>s+a.duration/60,0);
        const actAll=[...f.activities,...f.sessions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,20);
        const totalPts=calcPts(f);
        const totalH=(totalMin/60).toFixed(1);

        let html='<h2 style="margin-bottom:16px"><i class="fas fa-user" style="color:var(--primary)"></i> '+esc(f.name)+'\'s Profile</h2>';

        // Stats row
        html+='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">';
        html+='<div style="text-align:center;padding:12px;background:rgba(108,92,231,.1);border-radius:10px"><div style="font-size:1.3rem;font-weight:700">'+totalH+'h</div><div style="font-size:.7rem;color:var(--muted)">Study Time</div></div>';
        html+='<div style="text-align:center;padding:12px;background:rgba(253,121,168,.1);border-radius:10px"><div style="font-size:1.3rem;font-weight:700">'+f.streak+'</div><div style="font-size:.7rem;color:var(--muted)">Day Streak</div></div>';
        html+='<div style="text-align:center;padding:12px;background:rgba(253,203,110,.1);border-radius:10px"><div style="font-size:1.3rem;font-weight:700">'+totalPts+'</div><div style="font-size:.7rem;color:var(--muted)">Points</div></div>';
        html+='<div style="text-align:center;padding:12px;background:rgba(0,184,148,.1);border-radius:10px"><div style="font-size:1.3rem;font-weight:700">Lv.'+(f.level||1)+'</div><div style="font-size:.7rem;color:var(--muted)">Level</div></div>';
        html+='</div>';

        // XP bar
        const lvl=f.level||1,xp=f.xp||0,cur=levels[lvl-1]?levels[lvl-1].req:0,nxt=levels[lvl]?levels[lvl].req:cur+500;
        const pct=Math.min(100,((xp-cur)/(nxt-cur))*100);
        html+='<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:4px"><span>'+(levels[lvl-1]?levels[lvl-1].name:'Legend')+'</span><span>'+xp+' / '+nxt+' XP</span></div><div class="xp-bar"><div class="xp-fill" style="width:'+pct+'%"></div></div></div>';

        // Goals
        if(f.goals.length){
            html+='<div style="margin-bottom:16px"><h3 style="font-size:.9rem;margin-bottom:8px"><i class="fas fa-bullseye" style="color:var(--warning)"></i> Goals</h3>';
            f.goals.forEach(g=>{
                const p=(g.current/g.target*100).toFixed(0);
                html+='<div style="padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:.8rem;margin-bottom:4px"><span>'+g.emoji+' '+esc(g.title)+'</span><span>'+p+'%</span></div><div class="pb"><div class="pf" style="width:'+p+'%"></div></div></div>';
            });
            html+='</div>';
        }

        // Badges
        if(f.badges&&f.badges.length){
            html+='<div style="margin-bottom:16px"><h3 style="font-size:.9rem;margin-bottom:8px"><i class="fas fa-medal" style="color:var(--accent)"></i> Badges</h3><div style="display:flex;gap:6px;flex-wrap:wrap">';
            f.badges.forEach(bid=>{const b=allBadges.find(x=>x.id===bid);if(b)html+='<div style="padding:6px 10px;background:rgba(253,203,110,.1);border-radius:8px;font-size:.8rem">'+b.icon+' '+b.name+'</div>'});
            html+='</div></div>';
        }

        // Recent activities
        html+='<div><h3 style="font-size:.9rem;margin-bottom:8px"><i class="fas fa-clipboard-list" style="color:var(--secondary)"></i> Recent Activities</h3>';
        if(actAll.length){
            html+=actAll.map(a=>{
                const d=a.duration>=3600?(a.duration/3600).toFixed(1)+'h':Math.round(a.duration/60)+'m';
                const t=new Date(a.date);
                const dateStr=t.toLocaleDateString([],{month:'short',day:'numeric'});
                const timeStr=t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
                return'<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:4px"><span style="font-size:1.1rem">'+(icons[a.type]||'ðŸ“‹')+'</span><div style="flex:1"><div style="font-size:.8rem;font-weight:500">'+esc(a.description||a.type)+'</div><div style="font-size:.7rem;color:var(--muted)">'+dateStr+' '+timeStr+'</div></div><span style="font-size:.8rem;font-weight:600;color:var(--primary-light)">'+d+'</span></div>';
            }).join('');
        }else{
            html+='<div style="text-align:center;padding:16px;color:var(--muted);font-size:.8rem">No activities yet</div>';
        }
        html+='</div>';

        document.getElementById('friendProfileContent').innerHTML=html;
        openModal('friendProfile');
    }

    function switchFriendFromProfile(){
        closeModal('friendProfile');
        if(viewingFriendId){currentFriend=viewingFriendId;renderFriendToggle();showPage('dashboard')}
    }

    // Friend code system
    function generateMyCode(){
        const me=data.friends[1];
        if(!me.myCode)me.myCode=genCode();
        localStorage.setItem('friendsTracker',JSON.stringify(data));
        document.getElementById('myCode').textContent=me.myCode;
        // Register code in Firebase so friends can look it up
        if(syncEnabled&&fbDb&&currentUid){
            fbDb.ref('friendCodeMap/'+me.myCode).set(currentUid);
        }
    }
    function copyMyCode(){let c=data.friends[1].myCode;if(!c){generateMyCode();c=data.friends[1].myCode}navigator.clipboard.writeText(c).then(()=>{const b=document.getElementById('copyCodeBtn');b.innerHTML='<i class="fas fa-check"></i>';setTimeout(()=>b.innerHTML='<i class="fas fa-copy"></i>',1500)})}

    // ===== QR CODE =====
    let qrVisible=false;
    function toggleQR(){
        const c=document.getElementById('qrContainer'),btn=document.getElementById('qrToggleBtn');
        const code=data.friends[1].myCode;
        if(!code){alert('Generate a code first!');return}
        qrVisible=!qrVisible;
        if(qrVisible){
            c.style.display='block';
            btn.innerHTML='<i class="fas fa-eye-slash"></i> Hide QR';
            document.getElementById('qrImage').src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=STUDYBUDDY:'+code+'&color=6c5ce7&bgcolor=ffffff&margin=10';
        }else{
            c.style.display='none';
            btn.innerHTML='<i class="fas fa-qrcode"></i> Show QR';
        }
    }

    let html5QrScanner=null;
    function startQRScan(){
        openModal('qrScan');
        document.getElementById('qrScanStatus').textContent='Initializing camera...';
        if(!document.getElementById('qrReader').querySelector('video')){
            document.getElementById('qrReader').innerHTML='';
        }
        try{
            html5QrScanner=new Html5Qrcode('qrReader');
            html5QrScanner.start(
                {facingMode:'environment'},
                {fps:10,qrbox:{width:220,height:220}},
                onQRScanSuccess,
                ()=>{}
            ).then(()=>{
                document.getElementById('qrScanStatus').textContent='Point camera at QR code';
            }).catch(err=>{
                document.getElementById('qrScanStatus').textContent='Camera access denied. Type code manually.';
                console.log('Camera error:',err);
            });
        }catch(e){
            document.getElementById('qrScanStatus').textContent='Scanner not available. Type code manually.';
            console.log('QR scanner error:',e);
        }
    }

    function onQRScanSuccess(decodedText){
        stopQRScan();
        let code=decodedText;
        if(code.startsWith('STUDYBUDDY:'))code=code.replace('STUDYBUDDY:','');
        code=code.trim().toUpperCase();
        if(code.length>=4){
            document.getElementById('addFriendCode').value=code;
            document.getElementById('qrScanStatus').textContent='Code scanned: '+code;
            setTimeout(()=>closeModal('qrScan'),500);
        }else{
            document.getElementById('qrScanStatus').textContent='Invalid QR code. Try again.';
        }
    }

    function stopQRScan(){
        if(html5QrScanner){
            html5QrScanner.stop().then(()=>{html5QrScanner.clear();html5QrScanner=null}).catch(()=>{html5QrScanner=null});
        }
        closeModal('qrScan');
    }
    function addFriendByCode(){
        const code=document.getElementById('addFriendCode').value.trim().toUpperCase(),name=document.getElementById('addFriendName').value.trim();
        if(!code||!name)return alert('Fill all fields');
        if(data.friendCodes&&data.friendCodes[code])return alert('Already added!');
        if(code===data.friends[1].myCode)return alert("Can't add yourself!");
        if(code.length!==6)return alert('Invalid code!');
        const ids=Object.keys(data.friends).map(Number),newId=ids.length?Math.max(...ids)+1:2;
        data.friends[newId]={name,code,activities:[],sessions:[],goals:[],streak:0,lastActive:null,xp:0,level:1,badges:[],streakFreezes:0,addedAt:new Date().toISOString()};
        if(!data.friendCodes)data.friendCodes={};
        data.friendCodes[code]=newId;
        if(!data.friendUids)data.friendUids={};
        document.getElementById('addFriendCode').value='';document.getElementById('addFriendName').value='';
        currentFriend=newId;renderFriendToggle();saveData(data);renderAll();
        // Try to find friend's UID and notify them
        if(syncEnabled&&fbDb&&currentUid){
            fbDb.ref('friendCodeMap/'+code).once('value').then(snap=>{
                const friendUid=snap.val();
                if(friendUid){
                    data.friendUids[friendUid]=newId;
                    localStorage.setItem('friendsTracker',JSON.stringify(data));
                    // Notify friend so they see us too
                    const myCode=data.friends[1].myCode;
                    const myName=data.friends[1].name;
                    fbDb.ref('users/'+friendUid+'/incomingFriends/'+currentUid).set({name:myName,code:myCode,uid:currentUid,time:Date.now()});
                    listenFromFirebase();
                    connectFriendByUid(friendUid).then(fname=>{
                        if(fname)alert("Connected! You and "+fname+" can now see each other's activities.");
                    });
                }else{
                    alert('Friend added. They need to open the app for sync to work.');
                }
            }).catch(()=>alert('Friend added. Sync will work once both phones are connected.'));
        }else{
            alert('Friend added! Login and setup sync to see their data.');
        }
    }
    function removeFriend(id){if(id===1)return;if(!confirm('Remove?'))return;const code=data.friends[id].code;if(code)delete data.friendCodes[code];delete data.friends[id];saveData(data);currentFriend=1;renderFriendToggle();renderAll()}

    // Streak freeze
    function useStreakFreeze(){
        const f=data.friends[currentFriend],weekStart=new Date();weekStart.setDate(weekStart.getDate()-weekStart.getDay());weekStart.setHours(0,0,0,0);
        const freezes=(f._weeklyFreezes||[]).filter(d=>new Date(d)>weekStart);
        if(freezes.length>=1)return alert('Already used this week!');
        if(!f._weeklyFreezes)f._weeklyFreezes=[];
        f._weeklyFreezes.push(new Date().toISOString());
        saveData(data);renderAll();alert('Streak freeze activated!');
    }

    // ===== ACHIEVEMENTS =====
    const ALL_BADGES=[
        {id:'first_log',icon:'ðŸ“',name:'First Step',desc:'Log your first activity',check:f=>f.activities.length>=1},
        {id:'ten_logs',icon:'ðŸ”Ÿ',name:'Getting Started',desc:'Log 10 activities',check:f=>f.activities.length>=10},
        {id:'fifty_logs',icon:'ðŸ“š',name:'Bookworm',desc:'Log 50 activities',check:f=>f.activities.length>=50},
        {id:'hundred_logs',icon:'ðŸ’¯',name:'Century Club',desc:'Log 100 activities',check:f=>f.activities.length>=100},
        {id:'streak3',icon:'ðŸ”¥',name:'On Fire',desc:'3-day streak',check:f=>f.streak>=3},
        {id:'streak7',icon:'âš¡',name:'Unstoppable',desc:'7-day streak',check:f=>f.streak>=7},
        {id:'streak14',icon:'ðŸ’Ž',name:'Diamond Will',desc:'14-day streak',check:f=>f.streak>=14},
        {id:'streak30',icon:'ðŸ‘‘',name:'Legend',desc:'30-day streak',check:f=>f.streak>=30},
        {id:'level5',icon:'â­',name:'Rising Star',desc:'Reach Level 5',check:f=>(f.level||1)>=5},
        {id:'level10',icon:'ðŸŒŸ',name:'Superstar',desc:'Reach Level 10',check:f=>(f.level||1)>=10},
        {id:'level25',icon:'ðŸ’«',name:'Cosmic',desc:'Reach Level 25',check:f=>(f.level||1)>=25},
        {id:'xp1000',icon:'ðŸ†',name:'Champion',desc:'Earn 1000 XP',check:f=>(f.xp||0)>=1000},
        {id:'xp5000',icon:'ðŸŽ–ï¸',name:'Grandmaster',desc:'Earn 5000 XP',check:f=>(f.xp||0)>=5000},
        {id:'first_friend',icon:'ðŸ¤',name:'Social Butterfly',desc:'Add your first friend',check:(f,ids)=>ids.length>=2},
        {id:'goal1',icon:'ðŸŽ¯',name:'Goal Getter',desc:'Complete a goal',check:f=>f.goals&&f.goals.some(g=>g.progress>=g.target)},
        {id:'hour10',icon:'â°',name:'Dedicated',desc:'Study 10 total hours',check:f=>f.sessions.reduce((a,s)=>a+s.duration,0)/3600>=10},
        {id:'hour50',icon:'ðŸŽ“',name:'Scholar',desc:'Study 50 total hours',check:f=>f.sessions.reduce((a,s)=>a+s.duration,0)/3600>=50},
        {id:'early_bird',icon:'ðŸ¦',name:'Early Bird',desc:'Log activity before 7 AM',check:f=>f.activities.some(a=>{const h=new Date(a.time).getHours();return h<7})},
        {id:'night_owl',icon:'ðŸ¦‰',name:'Night Owl',desc:'Log activity after 11 PM',check:f=>f.activities.some(a=>{const h=new Date(a.time).getHours();return h>=23})},
        {id:'polyglot',icon:'ðŸŒˆ',name:'Polyglot',desc:'Log 5 different activity types',check:f=>new Set(f.activities.map(a=>a.type)).size>=5},
    ];

    function renderAchievements(){
        const f=data.friends[currentFriend]||data.friends[1];
        const ids=Object.keys(data.friends);
        const unlocked=ALL_BADGES.filter(b=>b.check(f,ids));
        const stats=document.getElementById('achieveStats');
        const grid=document.getElementById('badgeGrid');
        if(!stats||!grid)return;
        stats.innerHTML=
            '<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:var(--warning)">'+unlocked.length+'</div><div style="font-size:.75rem;color:var(--muted)">Unlocked</div></div>'+
            '<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:var(--muted)">'+(ALL_BADGES.length-unlocked.length)+'</div><div style="font-size:.75rem;color:var(--muted)">Locked</div></div>'+
            '<div style="text-align:center"><div style="font-size:1.8rem;font-weight:700;color:var(--success)">'+Math.round(unlocked.length/ALL_BADGES.length*100)+'%</div><div style="font-size:.75rem;color:var(--muted)">Complete</div></div>';
        grid.innerHTML=ALL_BADGES.map(b=>{
            const isUnlocked=unlocked.includes(b);
            return'<div class="badge-card '+(isUnlocked?'unlocked':'locked')+'"><span class="badge-icon">'+b.icon+'</span><div class="badge-name">'+b.name+'</div><div class="badge-desc">'+b.desc+'</div></div>';
        }).join('');
    }

    // ===== LEADERBOARD =====
    function renderLeaderboard(){
        const ids=Object.keys(data.friends);
        const ranked=ids.map(id=>{const f=data.friends[id];return{id,...f,xp:f.xp||0,level:f.level||1,score:(f.xp||0)+((f.level||1)*100)+(f.streak*50)}}).sort((a,b)=>b.score-a.score);
        const colors=['#6c5ce7','#00cec9','#fd79a8','#00b894','#fdcb6e','#e17055'];
        const podiumEl=document.getElementById('podium');
        const listEl=document.getElementById('lbList');
        if(!podiumEl||!listEl)return;
        // Podium (top 3)
        const podium=ranked.slice(0,3);
        const podiumOrder=podium.length>=3?[podium[1],podium[0],podium[2]]:podium.length===2?[podium[1],podium[0]]:[podium[0]];
        podiumEl.innerHTML=podiumOrder.map((p,i)=>{
            const realRank=i===0?2:i===1?1:i===2?3:i+1;
            const c=colors[ids.indexOf(p.id)%colors.length];
            const barH=realRank===1?120:realRank===2?90:70;
            let avHtml='';
            if(p.avatar&&p.avatar.startsWith('data:'))avHtml='<img src="'+p.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
            else if(p.avatar)avHtml=p.avatar;
            else avHtml=p.name.substring(0,2).toUpperCase();
            return'<div class="lb-place"><div class="lb-avatar" style="background:'+c+'">'+(realRank===1?'<span class="lb-crown">ðŸ‘‘</span>':'')+avHtml+'</div><div class="lb-name">'+p.name+'</div><div class="lb-xp">'+p.xp+' XP â€¢ Lv.'+p.level+'</div><div class="lb-bar" style="background:'+c+';height:'+barH+'px"></div><div style="font-size:1.2rem;margin-top:6px">'+(realRank===1?'ðŸ¥‡':realRank===2?'ðŸ¥ˆ':realRank===3?'ðŸ¥‰':'')+'</div></div>';
        }).join('');
        // List
        listEl.innerHTML=ranked.map((r,i)=>{
            const c=colors[ids.indexOf(r.id)%colors.length];
            let avHtml='';
            if(r.avatar&&r.avatar.startsWith('data:'))avHtml='<img src="'+r.avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover">';
            else if(r.avatar)avHtml=r.avatar;
            else avHtml=r.name.substring(0,2).toUpperCase();
            return'<div class="lb-list-item"><div class="lb-rank">'+(i+1)+'</div><div style="width:36px;height:36px;border-radius:50%;background:'+c+';display:flex;align-items:center;justify-content:center;font-size:.75rem">'+avHtml+'</div><div style="flex:1"><div style="font-weight:600;font-size:.9rem">'+r.name+'</div><div style="font-size:.7rem;color:var(--muted)">Level '+r.level+' â€¢ '+r.streak+' streak</div></div><div style="text-align:right"><div style="font-weight:700;color:var(--warning)">'+r.xp+' XP</div><div style="font-size:.65rem;color:var(--muted)">Score: '+r.score+'</div></div></div>';
        }).join('');
    }

    // ===== CALENDAR =====
    function renderCalendar(){
        const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
        const ml=document.getElementById('calMonthLabel');
        const grid=document.getElementById('calGrid');
        const summary=document.getElementById('calSummary');
        if(!ml||!grid)return;
        ml.textContent=months[calMonth]+' '+calYear;
        const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        let html=days.map(d=>'<div class="cal-head">'+d+'</div>').join('');
        const first=new Date(calYear,calMonth,1).getDay();
        const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
        const today=new Date();
        const f=data.friends[currentFriend]||data.friends[1];
        const activityMap={};
        (f.activities||[]).forEach(a=>{const d=new Date(a.time);if(d.getMonth()===calMonth&&d.getFullYear()===calYear){const day=d.getDate();activityMap[day]=(activityMap[day]||0)+1}});
        for(let i=0;i<first;i++)html+='<div class="cal-day" style="opacity:0"></div>';
        let totalDays=0,totalHours=0;
        for(let d=1;d<=daysInMonth;d++){
            const isToday=d===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear();
            const isFuture=new Date(calYear,calMonth,d)>today;
            const count=activityMap[d]||0;
            let cls='cal-day';
            if(isToday)cls+=' today';
            if(isFuture)cls+=' future';
            if(count>0)cls+=count>=3?' high-activity':' has-activity';
            html+='<div class="'+cls+'" title="'+count+' activities" onclick="showDayActivities('+d+')">'+d+'</div>';
            if(!isFuture&&count>0){totalDays++;totalHours+=count*0.5}
        }
        document.getElementById('calGrid').innerHTML=html;
        if(summary)summary.innerHTML=
            '<div style="text-align:center;padding:16px;background:rgba(108,92,231,.08);border-radius:10px"><div style="font-size:1.5rem;font-weight:700;color:var(--primary)">'+totalDays+'</div><div style="font-size:.75rem;color:var(--muted)">Active Days</div></div>'+
            '<div style="text-align:center;padding:16px;background:rgba(0,184,148,.08);border-radius:10px"><div style="font-size:1.5rem;font-weight:700;color:var(--success)">'+Object.keys(activityMap).length+'</div><div style="font-size:.75rem;color:var(--muted)">Days Logged</div></div>'+
            '<div style="text-align:center;padding:16px;background:rgba(253,121,168,.08);border-radius:10px"><div style="font-size:1.5rem;font-weight:700;color:var(--accent)">'+f.streak+'</div><div style="font-size:.75rem;color:var(--muted)">Current Streak</div></div>';
    }
    function changeCalMonth(dir){calMonth+=dir;if(calMonth>11){calMonth=0;calYear++}if(calMonth<0){calMonth=11;calYear--}renderCalendar()}
    function showDayActivities(day){
        const f=data.friends[currentFriend]||data.friends[1];
        const acts=(f.activities||[]).filter(a=>{const d=new Date(a.time);return d.getDate()===day&&d.getMonth()===calMonth&&d.getFullYear()===calYear});
        if(!acts.length)return alert('No activities on this day');
        alert('Activities on '+day+'/'+(calMonth+1)+':\n\n'+acts.map(a=>a.type+': '+a.desc+' ('+Math.round(a.duration/60)+'min)').join('\n'));
    }

    // ===== NOTES =====
    let editingNoteId=null;
    const noteColors=['#6c5ce7','#00cec9','#fd79a8','#00b894','#fdcb6e','#e17055','#a29bfe','#55efc4'];
    function renderNotes(){
        if(!data.notes)data.notes=[];
        const grid=document.getElementById('notesGrid');
        if(!data.notes.length){grid.innerHTML='<div class="empty" style="grid-column:1/-1"><i class="fas fa-sticky-note"></i><p>No notes yet. Create one!</p></div>';return}
        grid.innerHTML=data.notes.map(n=>'<div class="note-card" style="border-left:3px solid '+(n.color||'#6c5ce7')+'" onclick="editNote('+n.id+')"><div class="note-actions"><button class="btn bsm bc" onclick="event.stopPropagation();deleteNote('+n.id+')"><i class="fas fa-trash"></i></button></div><div class="note-title"><span style="color:'+(n.color||'#6c5ce7')+'">â—</span> '+esc(n.title||'Untitled')+'</div><div class="note-preview">'+esc(n.content||'')+'</div><div class="note-date"><i class="fas fa-clock"></i> '+new Date(n.updatedAt||n.createdAt).toLocaleDateString()+'</div></div>').join('');
    }
    function createNote(){
        editingNoteId=null;
        document.getElementById('noteTitleInput').value='';
        document.getElementById('noteContentInput').value='';
        document.getElementById('noteEditorTitle').textContent='New Note';
        document.getElementById('noteEditorWrap').style.display='block';
        document.getElementById('noteColors').innerHTML=noteColors.map((c,i)=>'<div class="note-color '+(i===0?'active':'')+'" style="background:'+c+'" onclick="pickNoteColor(this,\''+c+'\')"></div>').join('');
        document.getElementById('noteContentInput').focus();
    }
    function editNote(id){
        const note=data.notes.find(n=>n.id===id);if(!note)return;
        editingNoteId=id;
        document.getElementById('noteTitleInput').value=note.title||'';
        document.getElementById('noteContentInput').value=note.content||'';
        document.getElementById('noteEditorTitle').textContent='Edit Note';
        document.getElementById('noteEditorWrap').style.display='block';
        document.getElementById('noteColors').innerHTML=noteColors.map(c=>'<div class="note-color '+(c===note.color?'active':'')+'" style="background:'+c+'" onclick="pickNoteColor(this,\''+c+'\')"></div>').join('');
    }
    function pickNoteColor(el,color){
        document.querySelectorAll('.note-color').forEach(c=>c.classList.remove('active'));
        el.classList.add('active');
    }
    function saveNote(){
        const title=document.getElementById('noteTitleInput').value.trim();
        const content=document.getElementById('noteContentInput').value.trim();
        const activeColor=document.querySelector('.note-color.active');
        const color=activeColor?activeColor.style.background:'#6c5ce7';
        if(!title&&!content)return alert('Write something first!');
        if(!data.notes)data.notes=[];
        if(editingNoteId){
            const note=data.notes.find(n=>n.id===editingNoteId);
            if(note){note.title=title;note.content=content;note.color=color;note.updatedAt=new Date().toISOString()}
        }else{
            data.notes.push({id:Date.now(),title,content,color,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
        }
        saveData(data);renderNotes();closeNoteEditor();
    }
    function deleteNote(id){if(!confirm('Delete this note?'))return;data.notes=data.notes.filter(n=>n.id!==id);saveData(data);renderNotes()}
    function closeNoteEditor(){editingNoteId=null;document.getElementById('noteEditorWrap').style.display='none'}

    // ===== AMBIENCE SOUNDS =====
    let masterVolume=0.8;
    const sounds=[
        {id:'rain',icon:'ðŸŒ§ï¸',name:'Rain',freq:200,type:'rain'},
        {id:'thunder',icon:'â›ˆï¸',name:'Thunder',freq:80,type:'thunder'},
        {id:'forest',icon:'ðŸŒ²',name:'Forest',freq:400,type:'forest'},
        {id:'ocean',icon:'ðŸŒŠ',name:'Ocean',freq:150,type:'ocean'},
        {id:'cafe',icon:'â˜•',name:'Cafe',freq:300,type:'cafe'},
        {id:'fire',icon:'ðŸ”¥',name:'Fireplace',freq:250,type:'fire'},
        {id:'wind',icon:'ðŸ’¨',name:'Wind',freq:180,type:'wind'},
        {id:'whitenoise',icon:'ðŸ“»',name:'White Noise',freq:500,type:'white'},
        {id:'pinknoise',icon:'ðŸŽµ',name:'Pink Noise',freq:350,type:'pink'},
        {id:'night',icon:'ðŸ¦—',name:'Night',freq:600,type:'night'},
        {id:'birds',icon:'ðŸ¦',name:'Birds',freq:800,type:'birds'},
        {id:'piano',icon:'ðŸŽ¹',name:'Piano',freq:440,type:'piano'}
    ];
    let activeSounds={};
    function initSounds(){
        const grid=document.getElementById('soundsGrid');
        if(!grid)return;
        grid.innerHTML=sounds.map(s=>'<div class="sound-card" id="sc-'+s.id+'" onclick="toggleSound(\''+s.id+'\')"><span class="sound-icon">'+s.icon+'</span><div class="sound-name">'+s.name+'</div><div class="sound-vol" onclick="event.stopPropagation()"><input type="range" min="0" max="100" value="70" oninput="setSoundVolume(\''+s.id+'\',this.value)"></div><div class="mixer-bar"><div class="mixer-fill" id="mix-'+s.id+'" style="width:0%"></div></div><div class="sound-waves"></div></div>').join('');
        renderMixer();
    }
    function createNoiseBuffer(type,len){
        const sr=audioCtx.sampleRate;
        const buf=audioCtx.createBuffer(2,sr*len,sr);
        for(let ch=0;ch<2;ch++){
            const d=buf.getChannelData(ch);
            let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
            for(let i=0;i<d.length;i++){
                const white=Math.random()*2-1;
                if(type==='pink'){
                    b0=0.99886*b0+white*0.0555179;b1=0.99332*b1+white*0.0750759;b2=0.969*b2+white*0.153852;
                    b3=0.8665*b3+white*0.3104856;b4=0.55*b4+white*0.5329522;b5=-0.7616*b5-white*0.016898;
                    d[i]=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11;b6=white*0.115926;
                }else{
                    d[i]=white;
                }
            }
        }
        return buf;
    }
    function createOscBuffer(type,len){
        const sr=audioCtx.sampleRate;
        const buf=audioCtx.createBuffer(1,sr*len,sr);
        const d=buf.getChannelData(0);
        for(let i=0;i<d.length;i++){
            const t=i/sr;
            if(type==='rain')d[i]=(Math.random()*2-1)*Math.exp(-((t%0.3)*10))*0.3;
            else if(type==='ocean')d[i]=Math.sin(t*0.5)*0.3*(0.5+0.5*Math.sin(t*0.1));
            else if(type==='fire')d[i]=(Math.random()*2-1)*0.2*(0.3+0.7*Math.sin(t*2+Math.random()));
            else if(type==='wind')d[i]=(Math.random()*2-1)*0.15*Math.sin(t*0.3)*Math.sin(t*0.07);
            else if(type==='thunder')d[i]=(Math.random()*2-1)*Math.exp(-((t%2)*2))*0.5*(t%2<0.1?3:1);
            else if(type==='forest')d[i]=(Math.random()*2-1)*0.1+Math.sin(t*200)*0.02*Math.sin(t*3);
            else if(type==='cafe')d[i]=(Math.random()*2-1)*0.15*(0.5+0.5*Math.sin(t*0.2));
            else if(type==='night')d[i]=Math.sin(t*4000)*0.02*Math.sin(t*8)+Math.sin(t*6000)*0.015*Math.sin(t*5);
            else if(type==='birds')d[i]=Math.sin(t*2000+Math.sin(t*8)*500)*0.03*Math.max(0,Math.sin(t*0.5));
            else if(type==='piano')d[i]=Math.sin(t*440*Math.pow(2,Math.floor(t*2)%12/12))*0.1*Math.exp(-((t*2)%1)*3);
            else d[i]=(Math.random()*2-1)*0.2;
        }
        return buf;
    }
    function toggleSound(id){
        if(activeSounds[id]){
            activeSounds[id].gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.5);
            setTimeout(()=>{try{activeSounds[id].source.stop()}catch(e){}delete activeSounds[id];document.getElementById('sc-'+id).classList.remove('playing');document.getElementById('mix-'+id).style.width='0%'},500);
        }else{
            if(!audioCtx)audioCtx=new AudioCtx();
            const s=sounds.find(x=>x.id===id);
            const source=audioCtx.createBufferSource();
            const gain=audioCtx.createGain();
            const buf=createOscBuffer(s.type,4);
            source.buffer=buf;source.loop=true;
            gain.gain.value=0.7*masterVolume;
            source.connect(gain);gain.connect(audioCtx.destination);
            source.start();
            activeSounds[id]={source,gain,volume:0.7};
            document.getElementById('sc-'+id).classList.add('playing');
            document.getElementById('mix-'+id).style.width='70%';
        }
        renderMixer();
    }
    function setSoundVolume(id,val){
        const v=val/100;
        if(activeSounds[id]){activeSounds[id].gain.gain.linearRampToValueAtTime(v*masterVolume,audioCtx.currentTime+0.1);activeSounds[id].volume=v}
        document.getElementById('mix-'+id).style.width=val+'%';
    }
    function setMasterVolume(val){masterVolume=val/100;Object.keys(activeSounds).forEach(id=>{if(activeSounds[id])activeSounds[id].gain.gain.linearRampToValueAtTime(activeSounds[id].volume*masterVolume,audioCtx.currentTime+0.1)})}
    function stopAllSounds(){
        Object.keys(activeSounds).forEach(function(id){
            if(activeSounds[id]){
                activeSounds[id].gain.gain.linearRampToValueAtTime(0,audioCtx.currentTime+0.5);
                setTimeout(function(){
                    try{activeSounds[id].source.stop()}catch(e){}
                    delete activeSounds[id];
                    var sc=document.getElementById('sc-'+id);
                    if(sc)sc.classList.remove('playing');
                    var mx=document.getElementById('mix-'+id);
                    if(mx)mx.style.width='0%';
                },500);
            }
        });
        setTimeout(renderMixer,600);
    }
    function renderMixer(){
        const el=document.getElementById('mixerPanel');
        const active=Object.keys(activeSounds);
        if(!active.length){el.innerHTML='<p style="text-align:center;color:var(--muted);font-size:.85rem;padding:20px">No sounds playing. Tap a sound above to start.</p>';return}
        el.innerHTML=active.map(id=>{const s=sounds.find(x=>x.id===id);const vol=Math.round((activeSounds[id].volume||0.7)*100);return'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:1.3rem">'+s.icon+'</span><span style="flex:1;font-size:.85rem">'+s.name+'</span><input type="range" min="0" max="100" value="'+vol+'" style="width:100px;accent-color:var(--primary)" oninput="setSoundVolume(\''+id+'\',this.value)"><button class="btn bsm bc" onclick="toggleSound(\''+id+'\')"><i class="fas fa-times"></i></button></div>'}).join('');
    }
    function saveSoundPreset(){
        const preset=Object.keys(activeSounds).map(id=>({id,volume:activeSounds[id].volume}));
        localStorage.setItem('soundPreset',JSON.stringify(preset));
        alert('Sound preset saved!');
    }

    // ===== QUOTES =====
    const quotes=[
        {text:"The secret of getting ahead is getting started.",author:"Mark Twain"},
        {text:"It always seems impossible until it's done.",author:"Nelson Mandela"},
        {text:"Don't watch the clock; do what it does. Keep going.",author:"Sam Levenson"},
        {text:"The only way to do great work is to love what you do.",author:"Steve Jobs"},
        {text:"Success is not final, failure is not fatal: it is the courage to continue that counts.",author:"Winston Churchill"},
        {text:"Believe you can and you're halfway there.",author:"Theodore Roosevelt"},
        {text:"Hard work beats talent when talent doesn't work hard.",author:"Tim Notke"},
        {text:"The future belongs to those who believe in the beauty of their dreams.",author:"Eleanor Roosevelt"},
        {text:"Don't be pushed around by the fears in your mind. Be led by the dreams in your heart.",author:"Roy T. Bennett"},
        {text:"Learning is not attained by chance, it must be sought for with ardor.",author:"Abigail Adams"},
        {text:"The beautiful thing about learning is that no one can take it away from you.",author:"B.B. King"},
        {text:"Education is the passport to the future.",author:"Malcolm X"},
        {text:"Study hard, for the well is deep, and our brains are shallow.",author:"Richard Baxter"},
        {text:"The expert in anything was once a beginner.",author:"Helen Hayes"},
        {text:"You don't have to be great to start, but you have to start to be great.",author:"Zig Ziglar"},
        {text:"Small daily improvements are the key to staggering long-term results.",author:"Unknown"},
        {text:"Focus on being productive instead of busy.",author:"Tim Ferriss"},
        {text:"The only limit to our realization of tomorrow is our doubts of today.",author:"Franklin D. Roosevelt"},
        {text:"It does not matter how slowly you go as long as you do not stop.",author:"Confucius"},
        {text:"What we learn with pleasure we never forget.",author:"Alfred Mercier"},
    ];
    function newQuote(){
        const q=quotes[Math.floor(Math.random()*quotes.length)];
        const qt=document.getElementById('quoteText');
        const qa=document.getElementById('quoteAuthor');
        if(qt)qt.textContent=q.text;
        if(qa)qa.textContent='â€” '+q.author;
    }

    // ===== POMODORO =====
    let pomoState={phase:'work',minutes:25,seconds:0,total:25*60,remaining:25*60,sessions:0,maxSessions:4,breakLength:5,longBreakLength:15};
    function renderPomodoro(){
        const el=document.getElementById('pomodoroDisplay');
        if(!el)return;
        const circumference=2*Math.PI*95;
        const progress=pomoState.remaining/pomoState.total;
        const offset=circumference*(1-progress);
        const timeStr=String(Math.floor(pomoState.remaining/60)).padStart(2,'0')+':'+String(pomoState.remaining%60).padStart(2,'0');
        const phaseColor=pomoState.phase==='work'?'var(--primary)':pomoState.phase==='break'?'var(--success)':'var(--warning)';
        el.innerHTML='<div class="pomodoro-ring"><svg viewBox="0 0 200 200"><circle class="bg-ring" cx="100" cy="100" r="95"/><circle class="fg-ring" cx="100" cy="100" r="95" stroke-dasharray="'+circumference+'" stroke-dashoffset="'+offset+'" stroke="'+phaseColor+'"/></svg><div class="pomo-time"><div style="font-size:2.2rem;font-weight:700">'+timeStr+'</div><div style="font-size:.8rem;color:var(--muted)">'+(pomoState.phase==='work'?'ðŸ… Focus Time':pomoState.phase==='break'?'â˜• Short Break':'ðŸŒ´ Long Break')+'</div></div></div><div style="display:flex;gap:6px;justify-content:center;margin-top:8px">'+Array(pomoState.maxSessions).fill(0).map((_,i)=>'<div class="pomo-dot '+(i<pomoState.sessions?'done':i===pomoState.sessions&&pomoState.phase==='work'?'active':'')+'"></div>').join('')+'</div>';
    }
    function startPomodoroCycle(){
        if(isTimerRunning)return;
        pomoState.sessions=0;pomoState.phase='work';pomoState.remaining=pomoState.total=pomoState.minutes*60;
        currentSessionType='study';timerSeconds=pomoState.remaining;updateTimerDisplay();
        startTimer();
        renderPomodoro();
    }
    function pomoComplete(){
        playSound('done');
        if(pomoState.phase==='work'){
            pomoState.sessions++;
            if(pomoState.sessions>=pomoState.maxSessions){
                pomoState.phase='longbreak';pomoState.remaining=pomoState.total=pomoState.longBreakLength*60;
            }else{
                pomoState.phase='break';pomoState.remaining=pomoState.total=pomoState.breakLength*60;
            }
            if(Notification.permission==='granted')new Notification('ðŸ… Pomodoro Complete!',{body:pomoState.phase==='longbreak'?'Take a long break!':'Take a 5 min break!',icon:'ðŸ…'});
        }else{
            pomoState.phase='work';pomoState.remaining=pomoState.total=pomoState.minutes*60;
            if(Notification.permission==='granted')new Notification('â° Break Over!',{body:'Time to focus!',icon:'â°'});
        }
        timerSeconds=pomoState.remaining;updateTimerDisplay();
        startTimer();
        renderPomodoro();
    }

    // ===== EXPORT =====
    function exportJSON(){
        const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='studybuddy-export-'+new Date().toISOString().slice(0,10)+'.json';a.click();
    }
    function exportCSV(){
        let csv='Date,Type,Description,Duration (min)\n';
        Object.values(data.friends).forEach(f=>{f.activities.forEach(a=>{csv+='"'+new Date(a.time).toISOString()+'","'+a.type+'","'+(a.desc||'').replace(/"/g,'""')+'",'+Math.round(a.duration/60)+'\n'})});
        const blob=new Blob([csv],{type:'text/csv'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='studybuddy-export-'+new Date().toISOString().slice(0,10)+'.csv';a.click();
    }

    // ===== AGENDA =====
    function renderAgenda(){
        const f=data.friends[currentFriend]||data.friends[1];
        const today=new Date().toDateString();
        const reminders=(data.reminders||[]).filter(r=>{
            if(!r.enabled)return false;
            const rt=new Date(r.time);
            if(r.repeat==='daily')return true;
            if(r.repeat==='weekdays')return[1,2,3,4,5].includes(rt.getDay());
            if(r.repeat==='weekends')return[0,6].includes(rt.getDay());
            return rt.toDateString()===today;
        }).sort((a,b)=>new Date(a.time)-new Date(b.time));
        const schedule=(data.schedule||[]).sort((a,b)=>a.time.localeCompare(b.time));
        const el=document.getElementById('agendaList');
        if(!el)return;
        if(!reminders.length&&!schedule.length){el.innerHTML='<div class="empty"><i class="fas fa-calendar-check"></i><p>No agenda items. Set reminders or schedule!</p></div>';return}
        let html='';
        if(schedule.length){
            html+='<div style="font-size:.75rem;color:var(--muted);margin-bottom:8px;font-weight:600">SCHEDULE</div>';
            html+=schedule.map(s=>'<div class="ai" style="border-left:3px solid var(--secondary)"><div class="aic" style="background:rgba(0,206,201,.2)">ðŸ“‹</div><div class="ainf"><h4>'+esc(s.activity)+'</h4><p>â° '+s.time+'</p></div></div>').join('');
        }
        if(reminders.length){
            html+='<div style="font-size:.75rem;color:var(--muted);margin:12px 0 8px;font-weight:600">REMINDERS</div>';
            html+=reminders.map(r=>'<div class="ai" style="border-left:3px solid var(--warning)"><div class="aic" style="background:rgba(253,203,110,.2)">ðŸ””</div><div class="ainf"><h4>'+esc(r.title)+'</h4><p>â° '+r.time+' â€¢ '+r.repeat+'</p></div><button class="btn bsm bc" onclick="toggleReminder('+r.id+')">'+(r.enabled?'<i class="fas fa-pause"></i>':'<i class="fas fa-play"></i>')+'</button></div>').join('');
        }
        el.innerHTML=html;
    }

    // ===== 3D CANVAS EFFECTS =====
    function init3D(){
        // === Three.js floating particles ===
        const canvas=document.getElementById('three-canvas');
        const scene=new THREE.Scene();
        const camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,.1,1000);
        camera.position.z=5;
        const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
        renderer.setSize(window.innerWidth,window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
        renderer.setClearColor(0x000000,0);

        // Particles
        const COUNT=800;
        const geo=new THREE.BufferGeometry();
        const pos=new Float32Array(COUNT*3);
        const colors=new Float32Array(COUNT*3);
        const sizes=new Float32Array(COUNT);
        const speeds=new Float32Array(COUNT);
        const palette=[[.424,.361,.898],[0,.808,.788],[.988,.475,.659],[.988,.831,.541],[0,.722,.604]];
        for(let i=0;i<COUNT;i++){
            pos[i*3]=(Math.random()-.5)*20;
            pos[i*3+1]=(Math.random()-.5)*20;
            pos[i*3+2]=(Math.random()-.5)*10;
            const c=palette[Math.floor(Math.random()*palette.length)];
            colors[i*3]=c[0];colors[i*3+1]=c[1];colors[i*3+2]=c[2];
            sizes[i]=Math.random()*3+1;
            speeds[i]=Math.random()*.5+.2;
        }
        geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
        geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
        geo.setAttribute('size',new THREE.BufferAttribute(sizes,1));

        const mat=new THREE.PointsMaterial({
            size:.08,vertexColors:true,transparent:true,opacity:.7,
            blending:THREE.AdditiveBlending,depthWrite:false
        });
        const particles=new THREE.Points(geo,mat);
        scene.add(particles);

        // Connecting lines
        const lineGeo=new THREE.BufferGeometry();
        const linePos=new Float32Array(300*6);
        lineGeo.setAttribute('position',new THREE.BufferAttribute(linePos,3));
        const lineMat=new THREE.LineBasicMaterial({color:0x6c5ce7,transparent:true,opacity:.08,blending:THREE.AdditiveBlending});
        const lines=new THREE.Points(lineGeo,lineMat);
        scene.add(lines);

        // Mouse tracking
        let mouseX=0,mouseY=0;
        document.addEventListener('mousemove',e=>{
            mouseX=(e.clientX/window.innerWidth-.5)*2;
            mouseY=(e.clientY/window.innerHeight-.5)*2;
        });

        // Animate
        let t=0;
        function animate3D(){
            requestAnimationFrame(animate3D);
            t+=.005;
            particles.rotation.y=t*.3;
            particles.rotation.x=Math.sin(t*.5)*.1;
            // Mouse influence
            camera.position.x+=(mouseX*.5-camera.position.x)*.02;
            camera.position.y+=(-mouseY*.5-camera.position.y)*.02;
            camera.lookAt(0,0,0);
            // Wave particles
            const p=geo.attributes.position.array;
            for(let i=0;i<COUNT;i++){
                p[i*3+1]+=Math.sin(t*2+i*.1)*.003;
                p[i*3]+=Math.cos(t+i*.05)*.002;
            }
            geo.attributes.position.needsUpdate=true;
            // Update connecting lines (nearby particles)
            let li=0;
            const lp=lines.geometry.attributes.position.array;
            const threshold=2.5;
            for(let i=0;i<Math.min(COUNT,100)&&li<300;i++){
                for(let j=i+1;j<Math.min(COUNT,100)&&li<300;j++){
                    const dx=p[i*3]-p[j*3],dy=p[i*3+1]-p[j*3+1],dz=p[i*3+2]-p[j*3+2];
                    const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
                    if(dist<threshold){
                        lp[li*6]=p[i*3];lp[li*6+1]=p[i*3+1];lp[li*6+2]=p[i*3+2];
                        lp[li*6+3]=p[j*3];lp[li*6+4]=p[j*3+1];lp[li*6+5]=p[j*3+2];
                        li++;
                    }
                }
            }
            for(let i=li*6;i<300*6;i++)lp[i]=0;
            lines.geometry.attributes.position.needsUpdate=true;
            renderer.render(scene,camera);
        }
        animate3D();

        window.addEventListener('resize',()=>{
            camera.aspect=window.innerWidth/window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth,window.innerHeight);
        });

        // === Floating particles (DOM) ===
        const pf=document.getElementById('particleField');
        for(let i=0;i<30;i++){
            const p=document.createElement('div');
            p.className='particle';
            const size=Math.random()*4+2;
            p.style.cssText='width:'+size+'px;height:'+size+'px;left:'+Math.random()*100+'%;animation-duration:'+(Math.random()*15+10)+'s;animation-delay:'+(Math.random()*-20)+'s;--drift:'+(Math.random()*200-100)+'px;background:'+
                ['rgba(108,92,231,.4)','rgba(0,206,201,.4)','rgba(253,121,168,.3)','rgba(253,203,110,.3)'][Math.floor(Math.random()*4)];
            pf.appendChild(p);
        }

        // === 3D Card tilt ===
        document.querySelectorAll('.card-3d').forEach(card=>{
            card.addEventListener('mousemove',e=>{
                const r=card.getBoundingClientRect();
                const x=(e.clientX-r.left)/r.width-.5;
                const y=(e.clientY-r.top)/r.height-.5;
                card.style.setProperty('--tx',(-y*10)+'deg');
                card.style.setProperty('--ty',(x*10)+'deg');
                card.classList.add('tilt');
            });
            card.addEventListener('mouseleave',()=>{
                card.style.setProperty('--tx','0deg');
                card.style.setProperty('--ty','0deg');
                card.classList.remove('tilt');
            });
        });

        // === Click ripple effect ===
        document.addEventListener('click',e=>{
            const ripple=document.createElement('div');
            ripple.className='ripple';
            ripple.style.left=e.pageX+'px';
            ripple.style.top=e.pageY+'px';
            document.body.appendChild(ripple);
            setTimeout(()=>ripple.remove(),1500);
        });
    }

    // Init
    function init(){
        showLoading();
        initFirebase();
        init3D();
        initSounds();
        newQuote();
    }
    init();
    

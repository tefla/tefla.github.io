// Cloud auth + projects (Supabase). Ported from the pre-rewrite single-file
// build (tefla.github.io history, Deploy 2026-07-05T15:26). Guests see no
// behaviour change — nothing here touches the pattern pipeline. The vendored
// UMD build of @supabase/supabase-js (src/vendor/supabase.js, classic script
// tag) provides the `supabase` global; no CDN at runtime.
//
// initCloud(seam) is called from app.js init(); `seam` supplies the app
// integration points: serialize(), restore(data), hasImage(), getImage(),
// loadFile(file, onload).

var SUPABASE_URL = 'https://nrfeojccyejcflfjuyqv.supabase.co';
var PUBLISHABLE_KEY = 'sb_publishable_YmGsIGakesw-Xb_rnN_ouQ_jdjBVgfc';
var IMAGE_MAX_SIDE = 2048; // downscale bound for uploads

export function initCloud(seam) {
  var client = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY);
  var user = null;

  var $ = function (id) { return document.getElementById(id); };
  var loginBtn = $('loginBtn'), loginForm = $('loginForm'), loginEmail = $('loginEmail'),
      sendLinkBtn = $('sendLinkBtn'), cancelLoginBtn = $('cancelLoginBtn'),
      authedBox = $('authedBox'), userEmail = $('userEmail'), logoutBtn = $('logoutBtn'),
      authMsg = $('authMsg'), googleBtn = $('googleBtn');
  var projName = $('projName'), projSaveBtn = $('projSaveBtn'),
      projRefreshBtn = $('projRefreshBtn'), projMsg = $('projMsg'), projList = $('projList');

  // ---------- auth ----------

  function showMsg(text, isError) {
    authMsg.textContent = text;
    authMsg.classList.toggle('err', !!isError);
    authMsg.classList.toggle('hidden', !text);
  }

  // Redirect target for auth flows: this page, without hash/query. The
  // trailing slash is stripped (except at the site root) because Supabase's
  // redirect allowlist glob `*` does not match across `/` — `/tuft` passes
  // where `/tuft/` collapses to the Site URL. GitHub Pages 301s `/tuft`
  // back to `/tuft/` and browsers carry the token fragment across the hop.
  function pageUrl() {
    return location.origin +
      (location.pathname === '/' ? '/' : location.pathname.replace(/\/$/, ''));
  }

  function render(session) {
    user = session ? session.user : null;
    authedBox.classList.toggle('hidden', !user);
    loginBtn.classList.toggle('hidden', !!user || !loginForm.classList.contains('hidden'));
    if (user) {
      loginForm.classList.add('hidden');
      userEmail.textContent = user.email;
      showMsg('');
    }
  }

  loginBtn.addEventListener('click', function () {
    loginBtn.classList.add('hidden');
    loginForm.classList.remove('hidden');
    showMsg('');
    loginEmail.focus();
  });

  cancelLoginBtn.addEventListener('click', function () {
    loginForm.classList.add('hidden');
    loginBtn.classList.remove('hidden');
    showMsg('');
  });

  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = loginEmail.value.trim();
    if (!email) return;
    sendLinkBtn.disabled = true;
    showMsg('Sending…');
    client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: pageUrl() }
    }).then(function (res) {
      sendLinkBtn.disabled = false;
      if (res.error) {
        showMsg('Could not send the link: ' + res.error.message, true);
        return;
      }
      showMsg('Magic link sent — check your email, then open the link in this browser.');
    }, function (err) {
      sendLinkBtn.disabled = false;
      showMsg('Could not send the link: ' + err.message, true);
    });
  });

  // Google OAuth. The button stays hidden unless the project actually has
  // the provider enabled, so an unconfigured deploy shows no dead button.
  // /auth/v1/settings is a public, key-scoped endpoint.
  fetch(SUPABASE_URL + '/auth/v1/settings', {
    headers: { apikey: PUBLISHABLE_KEY }
  }).then(function (r) { return r.json(); }).then(function (s) {
    if (s && s.external && s.external.google) googleBtn.classList.remove('hidden');
  }).catch(function () { /* settings unreachable — leave the button hidden */ });

  googleBtn.addEventListener('click', function () {
    googleBtn.disabled = true;
    showMsg('Redirecting to Google…');
    client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: pageUrl() }
    }).then(function (res) {
      if (res.error) {
        googleBtn.disabled = false;
        showMsg('Google sign-in failed: ' + res.error.message, true);
      }
      // on success the browser navigates away; nothing to do here
    });
  });

  logoutBtn.addEventListener('click', function () {
    client.auth.signOut().then(function (res) {
      if (res.error) { showMsg('Sign-out failed: ' + res.error.message, true); return; }
      loginForm.classList.add('hidden');
      loginBtn.classList.remove('hidden');
    });
  });

  // ---------- projects panel ----------

  function msg(text, isError) {
    projMsg.textContent = text;
    projMsg.classList.toggle('err', !!isError);
    projMsg.classList.toggle('hidden', !text);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function guestRow(text) {
    projList.innerHTML = '<tr><td colspan="4" style="color:var(--ink-soft)">' + esc(text) + '</td></tr>';
  }

  function requireUser() {
    if (user) return user;
    msg('Sign in first — use the Sign in button at the top of the page.', true);
    return null;
  }

  // ---------- source-image storage ----------

  function downscaleToBlob(img, maxSide) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return new Promise(function (resolve, reject) {
      c.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('image encode failed'));
      }, 'image/png');
    });
  }

  // remove a project's storage object (no orphans on delete/overwrite)
  function deleteProjectImage(projectId) {
    return client.from('projects').select('image_path').eq('id', projectId).single()
      .then(function (res) {
        if (res.error) throw res.error;
        if (!res.data.image_path) return;
        return client.storage.from('tuft-images').remove([res.data.image_path])
          .then(function (r) { if (r.error) throw r.error; });
      });
  }

  // upload (or clear) the project's source image and point the row at it
  function saveImageFor(id) {
    if (!seam.hasImage()) {
      return deleteProjectImage(id).then(function () {
        return client.from('projects').update({ image_path: null }).eq('id', id)
          .then(function (r) { if (r.error) throw r.error; });
      });
    }
    return downscaleToBlob(seam.getImage(), IMAGE_MAX_SIDE).then(function (blob) {
      var path = user.id + '/' + id + '.png';
      return client.storage.from('tuft-images')
        .upload(path, blob, { upsert: true, contentType: 'image/png' })
        .then(function (r) {
          if (r.error) throw r.error;
          return client.from('projects').update({ image_path: path }).eq('id', id)
            .then(function (u) { if (u.error) throw u.error; });
        });
    });
  }

  // fetch a stored image and push it through the app's normal image-load
  // path (FileReader -> Image -> process), resolving once the chart has
  // regenerated — the caller then restores the saved settings on top
  function loadImageFromStorage(path) {
    return client.storage.from('tuft-images').download(path).then(function (res) {
      if (res.error) throw res.error;
      var file = new File([res.data], 'project-image.png', { type: res.data.type || 'image/png' });
      return new Promise(function (resolve) {
        seam.loadFile(file, resolve);
      });
    });
  }

  function renderList(rows) {
    if (!rows.length) { guestRow('No saved projects yet'); return; }
    projList.innerHTML = rows.map(function (r) {
      var when = r.updated_at ? new Date(r.updated_at).toLocaleString() : '';
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td>' + esc(r.name) + '</td>' +
        '<td class="hex">' + esc(when) + '</td>' +
        '<td><button class="autobtn projLoad" type="button">Load</button></td>' +
        '<td><button class="autobtn projDelete" type="button">Delete</button></td>' +
        '</tr>';
    }).join('');
  }

  function refreshList() {
    if (!user) { guestRow('Sign in to save and load projects'); return Promise.resolve(); }
    return client.from('projects')
      .select('id,name,updated_at')
      .eq('app', 'tuft')
      .order('updated_at', { ascending: false })
      .then(function (res) {
        if (res.error) { msg('Could not list projects: ' + res.error.message, true); return; }
        renderList(res.data);
      });
  }

  projSaveBtn.addEventListener('click', function () {
    if (!requireUser()) return;
    var name = projName.value.trim();
    if (!name) { msg('Give the project a name first.', true); projName.focus(); return; }
    var data = seam.serialize();
    projSaveBtn.disabled = true;
    msg('Saving…');
    client.from('projects').select('id').eq('app', 'tuft').eq('name', name)
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data.length) {
          return client.from('projects')
            .update({ data: data, updated_at: new Date().toISOString() })
            .eq('id', res.data[0].id)
            .then(function (r) { if (r.error) throw r.error; return res.data[0].id; });
        }
        return client.from('projects')
          .insert({ app: 'tuft', name: name, data: data })
          .select('id')
          .then(function (r) { if (r.error) throw r.error; return r.data[0].id; });
      })
      .then(function (id) {
        return saveImageFor(id).then(function () { return id; });
      })
      .then(function () {
        projSaveBtn.disabled = false;
        msg('Saved “' + name + '”.');
        return refreshList();
      })
      .catch(function (err) {
        projSaveBtn.disabled = false;
        msg('Save failed: ' + err.message, true);
      });
  });

  projRefreshBtn.addEventListener('click', function () {
    if (!requireUser()) return;
    refreshList();
  });

  projList.addEventListener('click', function (e) {
    var btn = e.target;
    if (!btn.classList || (!btn.classList.contains('projLoad') && !btn.classList.contains('projDelete'))) return;
    if (!requireUser()) return;
    var row = btn.closest('tr');
    var id = row.getAttribute('data-id');
    if (btn.classList.contains('projLoad')) {
      msg('Loading…');
      client.from('projects').select('id,name,data,image_path').eq('id', id).single()
        .then(function (res) {
          if (res.error) throw res.error;
          var finish = function () {
            seam.restore(res.data.data);
            projName.value = res.data.name;
            msg('Loaded “' + res.data.name + '”.');
          };
          if (res.data.image_path) {
            return loadImageFromStorage(res.data.image_path).then(finish);
          }
          finish();
        })
        .catch(function (err) { msg('Load failed: ' + err.message, true); });
    } else {
      msg('Deleting…');
      deleteProjectImage(id)
        .then(function () { return client.from('projects').delete().eq('id', id); })
        .then(function (res) {
          if (res.error) throw res.error;
          msg('Deleted.');
          return refreshList();
        })
        .catch(function (err) { msg('Delete failed: ' + err.message, true); });
    }
  });

  // fires with INITIAL_SESSION on load (including after a magic-link
  // redirect, which supabase-js consumes from the URL hash automatically)
  client.auth.onAuthStateChange(function (_event, session) {
    render(session);
    msg('');
    refreshList();
  });
}

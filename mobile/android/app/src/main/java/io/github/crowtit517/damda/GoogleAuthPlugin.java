package io.github.crowtit517.damda;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.ArrayList;
import java.util.List;

/**
 * 담다 갤럭시 앱 구글 로그인 (구글 공식 AuthorizationClient).
 * 폰에 로그인된 구글 계정을 골라 권한을 받는다. 한 번 허락하면 그다음부터는 화면 없이 새 토큰을 받는다
 * (토큰 갱신은 구글 플레이 서비스가 맡는다 → 로그인이 계속 유지된다). 보안 비밀이 없는 'Android' 클라이언트 방식.
 *
 * token({ scopes: [...], hint: 이메일, prompt: '' | 'select_account', silent: bool })
 *   → { token, scope, email, exp }
 */
@CapacitorPlugin(name = "DamdaGoogle")
public class GoogleAuthPlugin extends Plugin {
    private static final long TOKEN_MS = 55 * 60 * 1000L; // 구글 접근 토큰은 약 1시간. 조금 일찍 만료로 본다

    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall consentCall;
    private String consentEmail;

    @Override
    public void load() {
        // 동의 화면(처음 한 번, 또는 권한을 더 받을 때)
        consentLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = consentCall;
            consentCall = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) { call.reject("로그인을 취소했어요.", "CANCELLED"); return; }
            try {
                AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData());
                resolve(call, r, consentEmail);
            } catch (ApiException e) {
                call.reject("구글 로그인을 하지 못했어요.", "FAILED");
            }
        });
    }

    @PluginMethod
    public void token(PluginCall call) {
        String hint = call.getString("hint", "");
        String prompt = call.getString("prompt", "");
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        if (hint == null || hint.isEmpty() || "select_account".equals(prompt)) {
            if (silent) { call.reject("다시 로그인이 필요해요.", "NEED_LOGIN"); return; }
            // 어느 계정으로 할지 고르기 (폰에 로그인된 구글 계정 목록)
            Intent pick = AccountManager.newChooseAccountIntent(null, null, new String[] { "com.google" }, null, null, null, null);
            startActivityForResult(call, pick, "onAccountChosen");
            return;
        }
        authorize(call, hint, silent);
    }

    @ActivityCallback
    private void onAccountChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        String email = data == null ? null : data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
        if (result.getResultCode() != Activity.RESULT_OK || email == null) { call.reject("로그인을 취소했어요.", "CANCELLED"); return; }
        authorize(call, email, false);
    }

    private void authorize(PluginCall call, String email, boolean silent) {
        List<Scope> scopes = new ArrayList<>();
        try {
            JSArray arr = call.getArray("scopes", new JSArray());
            for (int i = 0; i < arr.length(); i++) scopes.add(new Scope(arr.getString(i)));
        } catch (Exception e) {
            call.reject("요청한 권한을 읽지 못했어요.", "FAILED");
            return;
        }
        AuthorizationRequest req = AuthorizationRequest.builder()
            .setRequestedScopes(scopes)
            .setAccount(new Account(email, "com.google"))
            .build();
        Identity.getAuthorizationClient(getActivity()).authorize(req)
            .addOnSuccessListener(r -> {
                if (!r.hasResolution()) { resolve(call, r, email); return; }
                // 아직 허락하지 않은 권한이 있음 → 동의 화면 (조용히만 시도할 때는 열지 않는다)
                if (silent || r.getPendingIntent() == null) { call.reject("다시 로그인이 필요해요.", "NEED_LOGIN"); return; }
                consentCall = call;
                consentEmail = email;
                consentLauncher.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
            })
            .addOnFailureListener(e -> call.reject(silent ? "다시 로그인이 필요해요." : "구글에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", silent ? "NEED_LOGIN" : "FAILED"));
    }

    private void resolve(PluginCall call, AuthorizationResult r, String email) {
        if (r.getAccessToken() == null) { call.reject("구글 로그인을 하지 못했어요.", "FAILED"); return; }
        JSObject out = new JSObject();
        out.put("token", r.getAccessToken());
        out.put("scope", String.join(" ", r.getGrantedScopes()));
        out.put("email", email);
        out.put("exp", System.currentTimeMillis() + TOKEN_MS);
        call.resolve(out);
    }
}

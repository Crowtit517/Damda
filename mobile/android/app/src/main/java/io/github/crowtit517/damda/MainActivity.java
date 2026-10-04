package io.github.crowtit517.damda;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GoogleAuthPlugin.class); // 담다 구글 로그인 (GoogleAuthPlugin.java)
        super.onCreate(savedInstanceState);
    }
}

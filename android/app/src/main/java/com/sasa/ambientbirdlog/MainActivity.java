package com.sasa.ambientbirdlog;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 起動直後の黒い画面に、WebView の縦スクロールバー（細い縦線）が出るのを防ぐ。
        // 一覧の中のスクロール領域（鳥の詳細など）は、画面の中で動くので影響しない
        WebView webView = getBridge().getWebView();
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
    }
}

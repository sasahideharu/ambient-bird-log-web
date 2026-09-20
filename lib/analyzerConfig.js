// 🔥 解析サーバー（Modal）の入口。server/analyzer_app.py をデプロイすると、この URL でつながる
//    （URL は、Modal の作業場の名前＋アプリ名から決まる。秘密の情報ではない。呼び出せるのは、ログイン中の管理者だけ）
export const ANALYZER_URL = "https://sasahideharu--ambient-bird-log-analyzer-web.modal.run";

// 1回の呼び出しで、サーバーが解析する MP3 の数の上限（server/analyzer_app.py の MAX_FILES_PER_REQUEST と同じ）
export const ANALYZER_MAX_FILES = 10;

// 音声を fetch したときの応答が、読めるものかを確かめる（読めなければ、エラーにする）。
// status 0 は許す：iPhone アプリは、端末に保存した音声（mp3・wav）を、普通の応答（200）ではなく、応答の印なしで返すため、
// 読めていても ok が false・status が 0 になる（中身は読める）。本当に読めないときは、そのあとのデコードで、エラーになる
export function assertAudioResponse(res) {
  if (!res.ok && res.status !== 0) throw new Error(`音声を取得できませんでした（${res.status}）`);
}

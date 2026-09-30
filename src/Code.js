// Adds a "Voice Notes" menu to Google Docs and opens the recorder in a pop-up.
// A pop-up is used instead of a sidebar because sidebars block the microphone.

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Voice Notes')
    .addItem('Record', 'showRecorder')
    .addToUi();
}

function showRecorder() {
  const html = HtmlService.createHtmlOutputFromFile('Recorder')
    .setWidth(360)
    .setHeight(260);
  DocumentApp.getUi().showModelessDialog(html, 'Voice Note');
}

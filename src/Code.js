// Adds a "Voice Notes" menu to Google Docs and opens the recorder sidebar.

function onOpen() {
  DocumentApp.getUi()
    .createMenu('Voice Notes')
    .addItem('Record', 'showSidebar')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Voice Note');
  DocumentApp.getUi().showSidebar(html);
}

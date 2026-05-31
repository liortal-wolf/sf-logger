import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const REPO_OWNER = 'liortal-wolf';
const REPO_NAME = 'sf-logger';
const SCRIPT_FILENAME = 'discord-sf-logger.user.js';
const RAW_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/dist/${SCRIPT_FILENAME}`;

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Discord → Salesforce Logger',
        namespace: 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME,
        version: '0.3.2',
        description: 'Log highlighted Discord conversations to Salesforce Opportunities with AI summaries',
        author: 'Overwolf',
        match: [
          'https://discord.com/*',
          'https://*.lightning.force.com/*'
        ],
        grant: [
          'GM_setValue',
          'GM_getValue',
          'GM_listValues',
          'GM_deleteValue',
          'GM_addValueChangeListener',
          'GM_xmlhttpRequest',
          'GM_registerMenuCommand',
          'GM_openInTab',
          'GM_setClipboard',
          'unsafeWindow'
        ],
        connect: ['api.anthropic.com'],
        updateURL: RAW_URL,
        downloadURL: RAW_URL,
        supportURL: `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`
      },
      build: {
        fileName: SCRIPT_FILENAME
      }
    })
  ]
});


/**
 * This function (recoverEmailBody) recovers
 * email header, body and attachment information
 * (but not the attachment itself) from thunderbird
 * global-message-db.sqlite database and saves
 * them as .eml files.
 *
 * recoverEmailBody first calls fetchData to
 * gather raw data from the sqlite database.
 * while fetching folder information, fetchData
 * calls createFolders to create the folder
 * architechture in the output folder.
 */
const InternetMessage = require(`internet-message`);
// for ease of recursive directory creation
const makeDir = require(`make-dir`);
// graceful-fs avoids too many open file error
const fs = require(`graceful-fs`);
const path = require(`path`);

const identitiesSource = require(`./export/identities`);
// apparently contains the same data as messages.jsonAttributes
// const messagesAttributes = require(`./export/messageAttributes`);
const messagesSource = require(`./export/messages`);
const attributesSource = require(`./export/attributeDefinitions`);
const contactsSource = require(`./export/contacts`);
// stores information about email conversations
// const conversationsSource = require(`./export/conversations`);
const mimeTypesSource = require(`./export/ext_mimeTypes`);
const foldersSource = require(`./export/folderLocations`);
const messagesContentsSource = require(`./export/messagesText_content`);

async function createFolders(f) {
  try {
    // folders names start like "imap://somebody@actual/path"
    // discarding the somebody part will merge emails and folders of several users or accounts
    const folder = decodeURI(f.folderURI).replace(/^\w+:\/\/([^@]+)@/, `$1/`).replace(/%40/g, `_at_`);
    const folderPath = path.join(`output`, folder);
    console.log(`creating path ${folderPath}`);
    await makeDir(folderPath);
    f.folderPath = folderPath;
    return f;
  } catch (err) {
    throw err;
  }
}

async function fetchData() {
  try {
    const folders = await Promise.all(foldersSource.map(createFolders)).then(f => f);
    const messages = messagesSource.filter(m => m.jsonAttributes !== ``)
      .sort((a, b) => parseInt(a.date, 10) - parseInt(b.date, 10));

    console.log(`fetchData complete`);
    return {
      attributes: attributesSource,
      contacts: contactsSource,
      // conversations: conversationsSource,
      mimeTypes: mimeTypesSource,
      folders,
      identities: identitiesSource,
      // messagesAttributes: messagesAttributesSource,
      messages,
      messagesContents: messagesContentsSource
    };
  } catch (err) {
    throw err;
  }
}

async function recoverEmailBody() {
  const {
    attributes,
    contacts,
    // conversations,
    mimeTypes,
    folders,
    identities,
    messages,
    messagesContents
  } = await fetchData();
  const conversationsTracker = {};

  try {
    // takes property name as argument and returns a reducing function
    // reduces array of {[a]:x, …} into an object indexed by the property a
    // passed as argument to the factory function
    const reduceToObject = prop => (o, c) => { o[c.id] = c[prop]; return o; };
    const attributeMatcher = attributes.reduce(reduceToObject(`name`), {});
    // replaces number keys of jsonAttributes by their names (to avoid configuration mismatch)
    const jsonAttributeReplacer = rawJsonAttributes => (o, c) => {
      o[attributeMatcher[c]] = rawJsonAttributes[c];
      return o;
    };
    // creates an object indexed by contact id storing the contact name and email
    const contactMatcher = contacts.reduce(
      (o, c) => {
        let email = identities.filter(i => i.contactID === c.id && i.kind === `email`);
        if (email.length) {
          email = email[0].value;
        } else {
          email = ``;
        }
        o[c.id] = {
          name: c.name,
          email
        };
        return o;
      },
      {}
    );
    const mimeTypeMatcher = mimeTypes.reduce(reduceToObject(`mimeType`), {});
    const folderMatcher = folders.reduce(reduceToObject(`folderPath`), {});

    /* eslint-disable no-restricted-syntax, no-prototype-builtins */
    let loopCnt = 0;
    for (const message of messages) {
      console.log(`Processing message #${loopCnt}`);
      message.headerMessageID = message.headerMessageID || loopCnt;
      let inReplyTo = false;
      if (conversationsTracker.hasOwnProperty(message.conversationID)) {
        inReplyTo = conversationsTracker[message.conversationID];
      }
      conversationsTracker[message.conversationID] = message.headerMessageID;

      const rawJsonAttributes = JSON.parse(message.jsonAttributes);
      const newJsonAttributes = Object.keys(rawJsonAttributes)
        .reduce(jsonAttributeReplacer(rawJsonAttributes), {});

      message.jsonAttributes = newJsonAttributes;

      message.jsonAttributes.from = `${contactMatcher[message.jsonAttributes.from].name} <${contactMatcher[message.jsonAttributes.from].email}>`;
      message.jsonAttributes.to = message.jsonAttributes.to
        .map(to => `${contactMatcher[to].name} <${contactMatcher[to].email}>`);
      message.jsonAttributes.cc = message.jsonAttributes.cc
        .map(to => `${contactMatcher[to].name} <${contactMatcher[to].email}>`);
      message.jsonAttributes.bcc = message.jsonAttributes.bcc
        .map(to => `${contactMatcher[to].name} <${contactMatcher[to].email}>`);
      message.jsonAttributes.attachmentTypes = (message.jsonAttributes.attachmentTypes || [])
        .map(type => mimeTypeMatcher[type]);
      let messageContents = messagesContents.filter(m => m.docid === message.id);
      if (messageContents.length) {
        messageContents = messageContents[0];
      } else {
        messageContents = {
          c0body: ``,
          c1subject: ``,
          c2attachmentNames: ``,
          c3author: ``,
          c4recipients: ``
        };
      }
      Object.assign(message, messageContents);
      // in my particular case, a user profile of 4Gb had become 0.9GB I had to salvage what could.
      // I do not know where attachments are supposed to be saved.
      // message.jsonAttributes.attachmentInfos seems to have an integer id for attachments
      // if you have your attachements still available and can figure out where they are and
      // how they are identified, you can add the attachments to the email.
      // lists them in the header with their "separator"
      // append them to the email body by printing header (mime type!) and body (mime type!) between
      // separators
      if (message.jsonAttributes.hasOwnProperty(`attachmentInfos`) && message.jsonAttributes.attachmentInfos.length) {
        let originalAttachments = message.jsonAttributes.attachmentInfos
          .map(i => `Original Attachment: Type: ${i[1]}; FileName: "${i[0]}"`)
          .join(`\n`);
        originalAttachments += `\n-------------\n`;
        message.c0body = originalAttachments + message.c0body;
      }
      const messageHeader = {
        From: message.jsonAttributes.from,
        To: message.jsonAttributes.to.join(`, `),
        "Message-ID": `<${message.headerMessageID}>`,
        Subject: message.c1subject,
        Date: new Date(parseInt(message.date, 10) / 1000).toUTCString(),
        "User-Agent": `Mozilla/5.0 (Windows NT 6.1; WOW64; rv:45.0) Gecko/20100101
   Thunderbird/45.4.0`,
        "MIME-Version": 1.0,
        "Content-Type": `text/plain; charset=utf-8; format=flowed`,
        "Content-Transfer-Encoding": `8bit`
      };
      if (message.jsonAttributes.cc) {
        messageHeader.Cc = message.jsonAttributes.cc.join(`, `);
      }
      if (message.jsonAttributes.cc) {
        messageHeader.Bcc = message.jsonAttributes.bcc.join(`, `);
      }
      if (inReplyTo) {
        messageHeader[`In-Reply-To`] = inReplyTo;
      }

      const msg = new InternetMessage(
        messageHeader,
        message.c0body
      );

      const folder = folderMatcher[message.folderID] || `no-folder`;
      const filename = (message.headerMessageID.replace(/[<>:"/\\|?*]/gi, ``) || loopCnt);
      const filePath = path.join(folder, `${filename}.eml`);
      console.log(`saving to ${filePath}`);
      fs.writeFile(filePath, msg);
      console.log(`Done processing #${loopCnt}`);
      loopCnt += 1;
    }
    // because async this is printed long before completion of the script.
    // at least we know the loo is over.
    console.log(`Done`);
  } catch (err) {
    throw err;
  }
}

recoverEmailBody();

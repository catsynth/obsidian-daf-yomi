import { App, ButtonComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import { Moment } from "moment";

// Not in the API - see https://discord.com/channels/686053708261228577/840286264964022302/880329814731546634
declare module "obsidian" {
    interface Vault {
        getConfig(option:"attachmentFolderPath"): string
    }
}

interface DYSettings {
	dyDir: string;      // Daf Yomi directory template in vault
	pageName: string;   // Page file name template
	pageTitle: string;  // Page title template
	sections: boolean;   // Make sections?
	litLinks: boolean;   // Make Literature Note links
	sefaria: boolean;   // Link to Sefaria?
	stpdflink: boolean; // Link to Steinsaltz PDF?
	stpdf: boolean;     // Download Steinsaltz PDF?
	stc: boolean;       // Link to Steinsaltz commentary?
	myjl: boolean;      // Link to My Jewish Learning commentary?
	dydg: boolean;      // Link to Daf Yomi Digest?
	hd: boolean;        // Link to Hadran?
}

const DEFAULT_SETTINGS: DYSettings = {
	dyDir: "/Home/Judaism/Daf Yomi/{tractate}/{page}",  // Directory template for Daf Yomi notes
	pageName: "Daf Yomi {tractate} {page}",  // Page file name template
	pageTitle: "Daf Yomi {tractate} {page}",  // Page title template
	sections: false,                  // Make sections?
	litLinks: false,                  // Make literature note links
	sefaria: false,                   // Link to Sefaria?
	stpdflink: true,                  // Link to Steinsaltz PDF?
	stpdf: false,                     // Embed Steinsaltz PDF?
	stc: true,                        // Link to Steinsaltz commentary?
	myjl: true,                       // Link to My Jewish Learning commentary?
	dydg: false,			     	  // Link to Daf Yomi Digest?
	hd:false                          // Link to Hadran?
}

// The tractate dates and names
interface Tractate {
	disp: string;     // The display name of the tractate
	linkName: string;  /// The name of the tractate for a link (no spaces)
	prakim: number[];  // The chapter (perek) breaks
	stpdf: string;    // URL fragment for Steinsaltz PDF
	stc: string;      // URL fragment for Steinsaltz commentary
	myjl: string;     // URL fragment for My Jewish Learning commentary
	sf: string;       // URL fragment for Sefaria
	dydg: string;     // URL fragment for Daf Yomi Digest
	hd: string;       // URL fragment for Hadran
};

interface Daf {
	tractate: Tractate;
	page: number;
};

export default class DafYomi extends Plugin {
	settings: DYSettings;
	tractates: Record<string, Tractate>;

	async onload() {
		await this.loadSettings();

		// The command to add a Daf Yomi page by date
		this.addCommand({
			id: 'dy-add-page-by-date',
			name: 'Add Daf Yomi page by date',
			callback: () => {
				new DYModalByDate(this.app, this).open();
			}
		});

		// The command to add a Daf Yomi page by daf
		this.addCommand({
			id: 'dy-add-page-by-daf',
			name: 'Add Daf Yomi page by tractate/daf',
			callback: () => {
				new DYModalByDaf(this.app, this).open();
			}
		});


		// The settings tab
		this.addSettingTab(new DYSettingTab(this.app, this));

		// Make the tractates table
		// For the Prakim (chapters), If the a side is in the new chapter, then that daf is in the new chapter. Otherwise,
		// that daf is in the old chapter and the next daf is in the new chapter.

		this.tractates = {
			"2022-02-11" : {disp:"Chagigah", prakim:[12, 21], stpdf:"Chagigah/Chagigah_", stc:"hagiga", myjl:'hagiga-', sf:'Chagigah.', dydg:'Chagiga%20', hd:'UNKNOWN-'},
			"2022-01-14" : {disp:"Moed Katan", prakim:[12, 14], stpdf:"Moed/Moed_", stc:'moed', myjl:'moed-katan-', sf:'Moed_Katan.', dydg:'MoedKatan%20', hd:'moed-katan-'},
			"2021-12-14" : {disp:"Megillah", prakim:[17, 21, 26], stpdf:"megilla/Megilla_", stc:'megilla', 	 myjl:'megillah-', sf:'Megillah.', dydg:'Megilla%20', hd:'megillah-'},
			"2021-11-14" : {disp:"Ta'anis", prakim:[15, 19, 26], stpdf:"Taanit/Taanit_", stc:'taanit', myjl:'taanit-', sf: 'Taanit.', dydg:'Taanis%20', hd:'taanit-' },
			"2021-10-11" : {disp:"Rosh Hashanah", prakim: [22, 26, 30], stpdf:"Beitza_RH/RoshHaShana_", stc:'roshhashana', myjl:'rosh-hashanah-', sf:'Rosh_Hashanah.', dydg:'RoshHaShana%20', hd:'rosh-hashanah-'},
			"2021-09-02" : {disp: "Beitzah", prakim: [16, 24, 30, 36], stpdf:"Beitza_RH/Beitza_", stc:'beitza', myjl:"beitzah-", sf:"Beitzah.", dydg:'Beitza%20', hd:'beitzah-'},
			"2021-07-09" : {disp: "Sukkah", prakim: [21, 30, 43, 50], stpdf:"Sukka/Sukkah_", stc:'sukka', myjl:'sukkah-', sf:'Sukkah.', dydg:'Sukkah%20', hd:'sukkah-'},
		};
	}

	// Add a Daf Yomi page by date
	async addPageByDate(dateS: string) {
		let dafDate = this.makeDate(dateS);
		let daf = this.findDafByDate(dafDate);

		if (!daf) {
			new Notice("Date does not match a Daf", 5000);
			return;
		}

		this.addPage(daf);
	}

	// Add the page
	async addPage(daf: any) {
		// Make the URLs

		// Steinsaltz PDF is doing leading zero for page numbers starting at Ta'anis
		let stpdf_leading = ["Ta'anis"];
		let stpdf_page = `${daf.page}`;
		if (stpdf_leading.includes(daf.tractate.disp)) {
			stpdf_page = `${daf.page.toString().padStart(2, "0")}`
		}

		const urls = {
			steinsaltz_pdf:  `https://www.steinsaltz-center.org/vault/DafYomi/${daf.tractate.stpdf}${stpdf_page}.pdf`,
			steinsaltz_c:    `https://steinsaltz.org/daf/${daf.tractate.stc}${daf.page}`,
			myjl:            `https://www.myjewishlearning.com/article/${daf.tractate.myjl}${daf.page}`,
			sf:              `https://www.sefaria.org/${daf.tractate.sf}${daf.page}`,
			dydg:            `https://www.dafdigest.org/masechtos/${daf.tractate.dydg}${daf.page.toString().padStart(3, "0")}.pdf`,
			hd:              `https://hadran.org.il/daf/${daf.tractate.hd}${daf.page}`
		};

		// Determine directory and page names
		const dirTemplate = this.settings.dyDir;
		const perek = this.findPerek(daf.page, daf.tractate.prakim)

		// Deal with the directory template - the default
		var directoryName = `${dirTemplate}/${daf.tractate.disp}`;

		// Does the template have tractate?
		if (dirTemplate.search(/{tractate}/i) >= 0) {
			directoryName = this.fillInTemplate(dirTemplate, daf, perek);
		}

		// Deal with the page name
		var pageName = `Daf Yomi ${daf.tractate.disp} ${daf.page}`;
		if (this.settings.pageName.search(/{page}/i) >= 0) {
			pageName = this.fillInTemplate(this.settings.pageName, daf, perek);
		}

		const pageFile = `${directoryName}/${pageName}.md`

		// Deal with page title
		var pageTitle = this.fillInTemplate(this.settings.pageTitle, daf, perek);

		// Don't overwrite an old file
		if (await this.app.vault.adapter.exists(pageFile)) {
			new Notice(`Note ${pageName} already exists`, 5000);
			return;
		};

		// Make directory if necessary
		if ( ! await this.app.vault.adapter.exists(directoryName) ) {
			await this.app.vault.adapter.mkdir(directoryName);
			new Notice(`Created directory ${directoryName}`);
		};

		// Make the page
		let t = `# ${pageTitle}\n\n`  // H1 title

		// Do we want to download the Steinsaltz PDF page?
		if (this.settings.sections && (this.settings.stpdf || this.settings.stpdflink)) {
			t += "## Koren Talmud Bavli\n";
		}

		if (this.settings.stpdf) {
			let url = urls.steinsaltz_pdf;
			let r = new Request(url);
			fetch(r).then( (r) => { return r.blob(); }).then(
				     (b) => { this.writeSteinsaltzPDF(b, directoryName, daf.tractate.disp, daf.page); });

			t += `![[${daf.tractate.disp}_${daf.page}.pdf]]\n`;
		}

		// Do we want a link to the Steinsaltz PDF (not downloaded)?
		if (this.settings.stpdflink) t += `[Steinsaltz PDF](${urls.steinsaltz_pdf})\n`;

		if (this.settings.sections && (this.settings.stpdf || this.settings.stpdflink)) {
			t += "\n";
		}

		// Do we want the Sefaria link?
		if (this.settings.sefaria) {
			if (this.settings.sections) t += "## Sefaria\n";
			t += `[Sefaria](${urls.sf})\n`;
			if (this.settings.sections) t += "\n";
		}

		// Do we want the Steinsaltz commentary?
		if (this.settings.stc) {
			if (this.settings.sections) t += "## Steinsaltz Commentary\n";
			t += `[Steinsaltz Commentary](${urls.steinsaltz_c})\n`;
			if (this.settings.sections) t += "\n";

		}

		// Do we want the My Jewish Learning commentary?
		if (this.settings.myjl) {
			if (this.settings.sections) t += "## My Jewish Learning Commentary\n";
			t += `[My Jewish Learning Commentary](${urls.myjl})\n`;
			if (this.settings.sections && this.settings.litLinks) {
				t += `See [[Notes/Literature/@MJL-${daf.tractate.linkName}${daf.page}]]\n`
			if (this.settings.sections) t += "\n";
		}

		// Do we want Daf Yomi Digest?
		if (this.settings.dydg) {
			if (this.settings.sections) t += "## Daf Yomi Digest\n";
			t += `[Daf Yomi Digest](${urls.dydg})\n`;
			if (this.settings.sections) t += "\n";
		}

		// Do we want Hadran?
		if (this.settings.hd) {
			if (this.settings.sections) t += "## Hadran Commentary\n";
			t += `[Hadran Commentary](${urls.hd})\n`;
			if (this.settings.sections) t += "\n";
		}

		if ( ! this.settings.sections ) t += '\n## Notes\n\n';

		// Write the page
		let dafPage = await this.app.vault.create(pageFile, t);
		new Notice(`Created note ${pageName}`);

		// Add to the Tractate page
		var tractatePage = `Tractate ${daf.tractate.disp}`;
		if (this.settings.dyDir.search(/{perek}/i) >= 0) {
			tractatePage += ` Perek ${perek}`;
		}
		const tractateFile = `${directoryName}/${tractatePage}.md`;
		const toAdd = `[[${pageName}|${daf.page}]]`;

		if ( ! await this.app.vault.adapter.exists(tractateFile) ) {
			const t = `# ${tractatePage}\n\n${toAdd}`;
			await this.app.vault.create(tractateFile, t);
			new Notice(`Created note ${tractatePage}`);
		}
		else {
			let current = await this.app.vault.adapter.read(tractateFile);
			await this.app.vault.adapter.write(tractateFile, current + " " + toAdd);
			new Notice(`Added to note ${tractatePage}`);
		}
		// Open the new page
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Utility functions
	// note the format:  fcn_name(param: type): return_type {}

	// Take a string and turn it into a Moment date with UTC (to avoid time changes)
	makeDate(dateS: string): Moment {
		return window.moment(`${dateS}T00:00:00.000Z`);
	}

	// Find the Perek (Chapter)
	findPerek(page: number, prakim: number[]): number {
		let perek: number = 1;
		for (var i = 0; i < prakim.length; ++i) {
			if (page < prakim[i]) break;
		}
		perek = i + 1;
		return perek;
	}

	// Find the daf for this date
	findDafByDate(dafDate: Moment): Daf | undefined {
		let startDate: Moment | undefined = undefined;
		let tractate:  Tractate | undefined = undefined;
		for (const k in this.tractates ) {
			startDate = this.makeDate(k);
			if ( dafDate >= startDate ) {
				tractate = this.tractates[k];
				break;
			}
		}

		// No tractate?
		if (! tractate ) {
			return undefined;
		}

		// Determine the page number
		let page: number = dafDate.diff(startDate, 'days') + 2;

		return {tractate: tractate, page: page};
	}

	// Find daf by name
	findDafByName(inTractate: string, inPage: number): Daf | undefined {
		let tractate: Tractate | undefined = undefined;
		for (const k in this.tractates) {
			if (inTractate == this.tractates[k].disp) {
				tractate = this.tractates[k];
				break;
			}
		}

		if (!tractate) {
			return undefined;
		}

		return { tractate: tractate, page: inPage };
	}

	fillInTemplate(template: string, daf: Daf, perek: number) : string {
		let name = template.replace(/{tractate}/gi, daf.tractate.disp);
		name = name.replace(/{perek}/gi, `${perek}`);
		name = name.replace(/{page}/gi, `${daf.page}`);
		return name;
	}

	// Write the PDF file we downloaded
	async writeSteinsaltzPDF(body: Blob, directoryName: string, tractate: string, page: number)  {
		let attachDir:string = this.app.vault.getConfig("attachmentFolderPath"); // Get attachment directory from Obsidian
		let pdfDir:string = directoryName

		if (attachDir == "/") {  // Top of the vault
			pdfDir = ""     // Will get leading / from pathName (see below)
		}
		else if (attachDir == "./") {  // Current directory
			pdfDir = directoryName
		}
		else if (attachDir.substring(0, 2) == "./" && attachDir.length > 2) { // Subdirectory of current
			pdfDir = directoryName + "/" + attachDir.substring(2)

			// Make directory?
			if ( ! await this.app.vault.adapter.exists(pdfDir) ) {
				await this.app.vault.adapter.mkdir(pdfDir);
				new Notice(`Created attachments directory ${pdfDir}`);
			};
		}
		else if (attachDir.substring(0, 1) != "/") {   // Absolute name
			pdfDir = "/" + attachDir
		};

		let pathName = `${pdfDir}/${tractate}_${page}.pdf`;
		this.app.vault.createBinary(pathName, await body.arrayBuffer() );
	}
}


// The Modal to ask for the date
class DYModalByDate extends Modal {
	plugin: DafYomi;

	constructor(app: App, plugin: DafYomi) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const {contentEl} = this;
		const dateField = new TextComponent(contentEl).setValue(window.moment().format("YYYY-MM-DD"));
		dateField.inputEl.id = "dy-date-input";

		const doAddPage = () => {
			const dateS = dateField.getValue();
			this.plugin.addPageByDate(dateS);
			this.close();
		};

		const addPageButton = new ButtonComponent(contentEl)
			.setButtonText("Add page")
			.onClick(doAddPage);
		addPageButton.buttonEl.id = 'dy-add-page-button';
		dateField.inputEl.focus();
		dateField.inputEl.addEventListener("keypress", function (keypressed) {
			if ( keypressed.key === "Enter") {
				doAddPage();
			}
		});
	}

	onClose() {
		let {contentEl} = this;
		contentEl.empty();
	}
}

// The Modal to ask for the tractate/daf
class DYModalByDaf extends Modal {
	plugin: DafYomi;

	constructor(app: App, plugin: DafYomi) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;

		// What is the daf for today?
		let today: Moment = window.moment()
		let daf = this.plugin.findDafByDate(today)

		const tractateField = new TextComponent(contentEl).setValue(`${daf.tractate.disp}`);
		const pageField = new TextComponent(contentEl).setValue(`${daf.page}`);
		tractateField.inputEl.id = "dy-tractate-input";
		pageField.inputEl.id = "dy-page-input";

		const doAddPage = () => {
			const inTractate = tractateField.getValue();
			const inPage = pageField.getValue();

			let theDaf = this.plugin.findDafByName(inTractate, parseInt(inPage));

			if (!theDaf) {
				new Notice("Tractate is unknown", 5000);
				return;
			}

			this.plugin.addPage(theDaf);
			this.close();
		};

		const addPageButton = new ButtonComponent(contentEl)
			.setButtonText("Add page")
			.onClick(doAddPage);
		addPageButton.buttonEl.id = 'dy-add-page-button';
		pageField.inputEl.focus();
		pageField.inputEl.addEventListener("keypress", function (keypressed) {
			if ( keypressed.key === "Enter") {
				doAddPage();
			}
		});
	}

	onClose() {
		let {contentEl} = this;
		contentEl.empty();
	}
}

// The settings pane
class DYSettingTab extends PluginSettingTab {
	plugin: DafYomi;

	constructor(app: App, plugin: DafYomi) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('p', {text: 'Daf Yomi settings'});

		new Setting(containerEl)
			.setName('Daf Yomi directory template')
			.setDesc('Directory in your Vault for Daf Yomi notes in the form of a template. Use {tractate} and {perek} for the tractate name and chapter (perek) number respectively. You must use {tractate} for uniqueness. {perek} is optional.')
			.addText(text => text
				.setPlaceholder('Daf Yomi directory template')
				.setValue(this.plugin.settings.dyDir)
				.onChange(async (value) => {
					if ( value.search(/{page}/i) >= 0) {
						new Notice("You must NOT have {page} in the directory template!", 5000)
						return;
					}
					this.plugin.settings.dyDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Page file name template')
		.setDesc('Template to use for the page file name (do NOT end in .md). Use {tractate}, {perek}, {page} for the tractate name, chapter (perek) number, and page number respectively. You must use {page} for uniqueness. {tractate} and {perek} are optional.')
		.addText(text => text
			.setPlaceholder('Daf Yomi page file name template')
			.setValue(this.plugin.settings.pageName)
			.onChange(async (value) => {
				this.plugin.settings.pageName = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
		.setName('Page title template')
		.setDesc('Template to use for the H1 title header of the page. Use {tractate}, {perek}, {page} for the tractate name, chapter (perek) number, and page number respectively. You likely should at least use {page}.')
		.addText(text => text
			.setPlaceholder('Daf Yomi directory template')
			.setValue(this.plugin.settings.pageTitle)
			.onChange(async (value) => {
				this.plugin.settings.pageTitle = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
		.setName("Make sections")
		.setDesc("Put each link in its own section")
		.addToggle( t => { t
			.setValue(this.plugin.settings.sections)
			.onChange(async (v) => {
				this.plugin.settings.sections = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
			.setName("Link to Steinsaltz PDF")
			.setDesc("Add link to Steinsaltz PDF")
			.addToggle( t => { t
				.setValue(this.plugin.settings.stpdflink)
				.onChange(async (v) => {
					this.plugin.settings.stpdflink = v;
					this.display();
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
		.setName("Download Steinsaltz PDF")
		.setDesc("Add Steinsaltz PDF")
		.addToggle( t => { t
			.setValue(this.plugin.settings.stpdf)
			.onChange(async (v) => {
				this.plugin.settings.stpdf = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
		.setName("Link to Sefaria")
		.setDesc("Add link to Sefaria")
		.addToggle( t => { t
			.setValue(this.plugin.settings.sefaria)
			.onChange(async (v) => {
				this.plugin.settings.sefaria = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
		.setName("Link to Steinsaltz commentary")
		.setDesc("Add link to Steinsaltz commentary")
		.addToggle( t => { t
			.setValue(this.plugin.settings.stc)
			.onChange(async (v) => {
				this.plugin.settings.stc = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
		.setName("Link to My Jewish Learning commentary")
		.setDesc("Add link to My Jewish Learning commentary")
		.addToggle( t => { t
			.setValue(this.plugin.settings.myjl)
			.onChange(async (v) => {
				this.plugin.settings.myjl = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
		.setName("Link to Daf Yomi Digest")
		.setDesc("Add link to Daf Yomi Digest (Chicago Center for Torah & Chesed)")
		.addToggle( t => { t
			.setValue(this.plugin.settings.dydg)
			.onChange(async (v) => {
				this.plugin.settings.dydg = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});

		new Setting(containerEl)
		.setName("Link to Hadran commentary")
		.setDesc("Add link to Hadran commentary")
		.addToggle( t => { t
			.setValue(this.plugin.settings.hd)
			.onChange(async (v) => {
				this.plugin.settings.hd = v;
				this.display();
				await this.plugin.saveSettings();
			});
		});
	}
}
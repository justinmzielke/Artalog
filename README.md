# Artalog

An art archive for your own work: keep records and images of your artworks, and generate application packages (images, labels, inventory, PDF) for open calls and residencies. Everything stays on your computer and works offline.

## Install (Windows)

1. Go to the [latest release](https://github.com/justinmzielke/artalog/releases/latest) and download **Artalog Setup x.y.z.exe**.
2. Run it. Windows may say "Windows protected your PC" because the app is not code-signed: choose **More info**, then **Run anyway**.
3. Choose where to install, then open **Artalog** from the desktop or Start menu icon. Right-click the taskbar icon and choose **Pin to taskbar** to keep it handy.
4. On first launch, pick the folder where your archive should live (the suggested `Documents\Artalog` is fine).

## Your data

Your records, images and settings live in the archive folder you chose, separate from the app. Updating or reinstalling Artalog never touches it. Putting the folder inside OneDrive, Dropbox or iCloud gives you automatic backup.

- **File > Back Up Archive...** saves everything as one ZIP.
- **File > Restore From Backup...** unpacks a ZIP into an empty folder and switches to it. It never overwrites an existing archive.
- **File > Change Archive Folder...** points Artalog at another folder.
- If an update changes the database structure, a safety copy is saved in the `backups` folder inside your archive first.

## Updates

Artalog checks for new versions when it starts and offers to restart when one is ready. You can also use **Help > Check for Updates...**.

## For developers

Requires Node.js 20 or newer.

```
npm install --prefix frontend
npm install --prefix backend
npm run dev                 # frontend on :5173/5174, backend on :4000
```

Build the installer locally:

```
npm install --prefix desktop
npm run dist --prefix desktop   # output in desktop/release
```

Publish a release: create a GitHub release with a tag such as `v0.2.0`. The `Release` workflow builds the installer and attaches it. Edit the draft release it creates, then click **Publish release** so the in-app updater can see it.

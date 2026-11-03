# Eigene RPM-Spec für Fedora / Bazzite.
# Wird von packaging/rpm/build-rpm.sh aufgerufen; verpackt das fertige
# Electron-Verzeichnis dist/linux-unpacked (kein Kompilieren nötig).

# Vorgebaute Binärdateien: kein Strippen, keine Debug-Pakete, keine Build-IDs
%global debug_package %{nil}
%global __os_install_post %{nil}
%global __strip /bin/true
%define _build_id_links none

Name:           simon-twitch
Version:        %{app_version}
Release:        1
Summary:        Bis zu 4 Twitch-Streams gleichzeitig
License:        MIT
URL:            https://github.com/lordsimon666/Simon-Twitch
BuildArch:      x86_64
AutoReqProv:    no
Requires:       gtk3, nss, libXScrnSaver, libXtst, xdg-utils, at-spi2-core, libuuid, libnotify, alsa-lib, mesa-libgbm

%description
Simon Twitch: Twitch-Client mit Stream-Fenster (bis zu 4 Streams),
Chat-Fenster (Chats aller Streams, einzeln oder Splitscreen) und
Browser-Fenster für twitch.tv.

%install
mkdir -p %{buildroot}/opt/simon-twitch \
         %{buildroot}%{_bindir} \
         %{buildroot}%{_datadir}/applications \
         %{buildroot}%{_datadir}/icons/hicolor/512x512/apps
cp -a %{app_dir}/. %{buildroot}/opt/simon-twitch/
ln -s /opt/simon-twitch/simon-twitch %{buildroot}%{_bindir}/simon-twitch
install -m 0644 %{app_icon} %{buildroot}%{_datadir}/icons/hicolor/512x512/apps/simon-twitch.png
install -m 0644 %{app_desktop} %{buildroot}%{_datadir}/applications/simon-twitch.desktop

%files
/opt/simon-twitch
%{_bindir}/simon-twitch
%{_datadir}/applications/simon-twitch.desktop
%{_datadir}/icons/hicolor/512x512/apps/simon-twitch.png

%post
# Chromium-Sandbox braucht setuid
chmod 4755 /opt/simon-twitch/chrome-sandbox || :

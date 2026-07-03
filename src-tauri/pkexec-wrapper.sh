#!/bin/sh
# Invoked only via pkexec, only for the narrow privileged step of a
# system-wide UE install/uninstall: moving an already-downloaded and
# already-extracted engine into /opt, or removing it. Never runs the
# download or zip extraction — those always happen as the regular user
# in a staging directory first.
#
# Usage:
#   pkexec-wrapper.sh install <staging_dir> <dest_dir>
#   pkexec-wrapper.sh uninstall <dest_dir>
#   pkexec-wrapper.sh install-desktop-entry <src_file> <dest_dir>
#   pkexec-wrapper.sh uninstall-desktop-entry <dest_file>

set -eu

action="${1:-}"

case "$action" in
  install)
    staging_dir="${2:?missing staging_dir}"
    dest_dir="${3:?missing dest_dir}"
    case "$dest_dir" in
      /opt/UnrealEngine/*) ;;
      *) echo "refusing to install outside /opt/UnrealEngine" >&2; exit 1 ;;
    esac
    mkdir -p "$(dirname "$dest_dir")"
    rm -rf "$dest_dir"
    mv "$staging_dir" "$dest_dir"
    chown -R root:root "$dest_dir"
    chmod -R a+rX "$dest_dir"
    ;;
  uninstall)
    dest_dir="${2:?missing dest_dir}"
    case "$dest_dir" in
      /opt/UnrealEngine/*) ;;
      *) echo "refusing to remove outside /opt/UnrealEngine" >&2; exit 1 ;;
    esac
    rm -rf "$dest_dir"
    ;;
  install-desktop-entry)
    src_file="${2:?missing src_file}"
    dest_dir="${3:?missing dest_dir}"
    case "$dest_dir" in
      /usr/share/applications) ;;
      *) echo "refusing to write desktop entry outside /usr/share/applications" >&2; exit 1 ;;
    esac
    mkdir -p "$dest_dir"
    cp "$src_file" "$dest_dir/"
    chmod 644 "$dest_dir/$(basename "$src_file")"
    ;;
  uninstall-desktop-entry)
    dest_file="${2:?missing dest_file}"
    case "$dest_file" in
      /usr/share/applications/*) ;;
      *) echo "refusing to remove outside /usr/share/applications" >&2; exit 1 ;;
    esac
    rm -f "$dest_file"
    ;;
  *)
    echo "usage: $0 {install|uninstall|install-desktop-entry|uninstall-desktop-entry} ..." >&2
    exit 1
    ;;
esac

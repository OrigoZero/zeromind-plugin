# Route this noninteractive Bash invocation through the installed Zero shell.
_zero_shell_bridge_entry="${BASH_SOURCE[0]%/*}/../dist/shell.js"
case "$OSTYPE" in
  msys*|cygwin*) _zero_shell_bridge_entry="$(cygpath -m "$_zero_shell_bridge_entry")" ;;
esac
# Keep engine paths literal when Git Bash launches Windows Node.
export MSYS2_ARG_CONV_EXCL='*'
unset BASH_ENV
if [[ ${BASH_EXECUTION_STRING+x} ]]; then
  exec node "$_zero_shell_bridge_entry" -c "$BASH_EXECUTION_STRING" "$0" "$@"
elif [[ $- == *s* ]]; then
  exec node "$_zero_shell_bridge_entry" -s "$@"
else
  exec node "$_zero_shell_bridge_entry" "$0" "$@"
fi

#!/bin/sh

netcat -w 2 alahele.ischool.uw.edu 8997
if [ $? -ne 0 ]; then
  echo "Stopping node.js server..."
  /home/webroot/node-reflex/stop_node_server.sh > /dev/null 2>&1 || true
  sleep 2
  echo "Starting node.js server..."
  /home/webroot/node-reflex/start_node_server.sh
fi

exit 0

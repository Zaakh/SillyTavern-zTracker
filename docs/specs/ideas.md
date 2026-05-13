- TOON has as required field which looks weird.  
- When adpating the json schema it is hard to edit because the field just blinks and my edit goes away. Maybe it's because of the live check thats executed on edits. We need a explicit "save" button to save the changes and run the check, instead of running the check on every edit. This way we can edit the json schema without it blinking and losing our changes. The "save" button should be disabled until the json is valid, and show an error message while the json is invalid. This way we can prevent the need to reset the field or saving invalid json and provide feedback to the user on what is wrong with their json.  
- A chat is bound to one tracker schema, making it impossible to "switch" the schema. So we need an "update" function (or similar) that allows us to update the schema of a chat without having to create a new chat.  
- Manual Tracker generatoin should always work, even if it is in the range of "skipped" messages.


